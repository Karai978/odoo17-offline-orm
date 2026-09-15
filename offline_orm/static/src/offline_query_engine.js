/**
 * Generic local ORM query engine.
 *
 * Operates only on canonical records and metadata. No application-specific
 * business logic belongs here.
 */

const MISSING = Symbol("missing");

export class OfflineQueryEngine {
    constructor({ database, metadata = null } = {}) {
        this.database = database;
        this.metadata = metadata;
    }

    async search(model, domain = [], options = {}) {
        const records = await this.database.findRecords(model);
        const matching = records.filter((record) => this.matchesDomain(record, domain, options));
        const ordered = this.orderRecords(matching, options.order);
        const offset = Number.isInteger(options.offset) ? Math.max(options.offset, 0) : 0;
        const limit = Number.isInteger(options.limit) ? options.limit : undefined;
        const sliced = limit === undefined || limit < 0
            ? ordered.slice(offset)
            : ordered.slice(offset, offset + limit);
        return sliced.map((record) => this.identity(record));
    }

    async searchCount(model, domain = [], options = {}) {
        const records = await this.database.findRecords(model);
        return records.filter((record) => this.matchesDomain(record, domain, options)).length;
    }

    async read(model, ids, fields = [], options = {}) {
        const wanted = new Set(ids || []);
        const records = await this.database.findRecords(model);
        return records
            .filter((record) => wanted.has(this.identity(record)))
            .map((record) => this.project(record, fields, options));
    }

    async searchRead(model, domain = [], fields = [], options = {}) {
        const ids = await this.search(model, domain, options);
        return this.read(model, ids, fields, options);
    }

    matchesDomain(record, domain = [], options = {}) {
        if (!domain || domain.length === 0) return true;
        const tokens = Array.isArray(domain) ? [...domain] : [];
        try {
            const [result, index] = this._evalExpression(record, tokens, 0, options);
            return Boolean(result) && index === tokens.length;
        } catch {
            // A malformed/unsupported local domain must not silently return
            // unrelated data. The local query therefore fails closed.
            return false;
        }
    }

    _evalExpression(record, tokens, index, options) {
        if (index >= tokens.length) return [true, index];
        const token = tokens[index];
        if (token === "!") {
            const [value, next] = this._evalExpression(record, tokens, index + 1, options);
            return [!value, next];
        }
        if (token === "|" || token === "&") {
            const [left, nextLeft] = this._evalExpression(record, tokens, index + 1, options);
            const [right, nextRight] = this._evalExpression(record, tokens, nextLeft, options);
            return [token === "|" ? left || right : left && right, nextRight];
        }
        if (Array.isArray(token)) {
            return [this._compare(record, token, options), index + 1];
        }

        // Odoo domains also allow implicit AND between consecutive terms.
        let result = true;
        let next = index;
        while (next < tokens.length && tokens[next] !== "|" && tokens[next] !== "&" && tokens[next] !== "!") {
            if (!Array.isArray(tokens[next])) throw new Error("Unsupported domain token");
            result = result && this._compare(record, tokens[next], options);
            next += 1;
        }
        return [result, next];
    }

    _compare(record, clause, options) {
        if (clause.length !== 3) throw new Error("Invalid domain clause");
        const [field, operator, expected] = clause;
        const actual = this._getFieldValue(record, field);
        const op = String(operator).toLowerCase();
        const left = actual === MISSING ? false : actual;

        if (op === "=?") return expected === false || expected === null || expected === undefined || this._equals(left, expected);
        if (op === "in" || op === "not in") {
            const values = Array.isArray(expected) ? expected : [expected];
            const found = this._membership(left, values);
            return op === "in" ? found : !found;
        }
        if (op === "=" || op === "==") return this._equals(left, expected);
        if (op === "!=" || op === "<>") return !this._equals(left, expected);
        if (op === "like" || op === "ilike" || op === "not like" || op === "not ilike") {
            const haystack = String(left ?? "");
            const needle = String(expected ?? "");
            const source = op.includes("ilike") ? haystack.toLowerCase() : haystack;
            const target = op.includes("ilike") ? needle.toLowerCase() : needle;
            const pattern = target.replaceAll("%", "");
            const found = pattern === "" || source.includes(pattern);
            return op.startsWith("not ") ? !found : found;
        }
        if ([">", ">=", "<", "<=").includes(op)) {
            const a = this._sortable(left);
            const b = this._sortable(expected);
            if (a === null || b === null) return false;
            if (op === ">") return a > b;
            if (op === ">=") return a >= b;
            if (op === "<") return a < b;
            return a <= b;
        }
        throw new Error(`Unsupported offline domain operator: ${operator}`);
    }

    _getFieldValue(record, fieldPath) {
        const parts = String(fieldPath).split(".");
        let value = record.values || {};
        for (const part of parts) {
            if (value === null || value === undefined) return MISSING;
            if (typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, part)) return MISSING;
            value = value[part];
        }
        return value;
    }

    _equals(actual, expected) {
        if (Array.isArray(actual) || Array.isArray(expected)) {
            return JSON.stringify(actual) === JSON.stringify(expected);
        }
        return actual === expected || String(actual ?? "") === String(expected ?? "");
    }

    _membership(actual, expected) {
        if (Array.isArray(actual)) return actual.some((value) => expected.some((item) => this._equals(value, item)));
        return expected.some((item) => this._equals(actual, item));
    }

    _sortable(value) {
        if (value === null || value === undefined || value === false) return null;
        if (value instanceof Date) return value.getTime();
        if (typeof value === "number") return value;
        const timestamp = Date.parse(String(value));
        return Number.isNaN(timestamp) ? String(value).toLowerCase() : timestamp;
    }

    orderRecords(records, order = "") {
        if (!order) return [...records];
        const clauses = String(order).split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
            const pieces = part.split(/\s+/);
            return { field: pieces[0], descending: pieces[1]?.toLowerCase() === "desc" };
        });
        return [...records].sort((left, right) => {
            for (const clause of clauses) {
                const a = this._sortable(this._getFieldValue(left, clause.field));
                const b = this._sortable(this._getFieldValue(right, clause.field));
                if (a === b) continue;
                if (a === null) return clause.descending ? 1 : -1;
                if (b === null) return clause.descending ? -1 : 1;
                if (a < b) return clause.descending ? 1 : -1;
                if (a > b) return clause.descending ? -1 : 1;
            }
            return 0;
        });
    }

    identity(record) {
        return record.server_id ?? record.local_id ?? record.local_uuid;
    }

    project(record, fields = [], _options = {}) {
        const result = { id: this.identity(record) };
        if (!fields || fields.length === 0) return { ...record.values, id: result.id };
        for (const field of fields) {
            if (Object.prototype.hasOwnProperty.call(record.values, field)) {
                result[field] = record.values[field];
            }
        }
        return result;
    }
}
