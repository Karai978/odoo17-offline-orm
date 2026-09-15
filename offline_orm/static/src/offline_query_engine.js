/**
 * Generic local ORM query engine for Odoo 17.
 *
 * The engine operates only on canonical records and metadata. It contains no
 * Sales, Purchase, CRM, Accounting, or other application-specific rules.
 */

const MISSING = Symbol("missing");

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

    async webRead(model, ids, specification = {}, options = {}) {
        const wanted = new Set(ids || []);
        const records = await this.database.findRecords(model);
        const selected = records.filter((record) => wanted.has(this.identity(record)));
        return Promise.all(selected.map((record) => this.projectSpecification(model, record, specification, options)));
    }

    async webSearchRead(model, domain = [], specification = {}, options = {}) {
        const offset = Number.isInteger(options.offset) ? options.offset : 0;
        const limit = options.limit === undefined ? undefined : Number(options.limit);
        const order = options.order || "";
        const all = await this.database.findRecords(model);
        const matching = all.filter((record) => this.matchesDomain(record, domain, options));
        const ordered = this.orderRecords(matching, order);
        const sliced = limit === undefined || limit < 0
            ? ordered.slice(offset)
            : ordered.slice(offset, offset + limit);
        const records = await Promise.all(
            sliced.map((record) => this.projectSpecification(model, record, specification, options))
        );

        const countLimit = options.count_limit;
        let length = offset + records.length;
        if (limit && records.length === limit && (!countLimit || length < countLimit || options.context?.force_search_count)) {
            length = countLimit ? Math.min(matching.length, countLimit) : matching.length;
        } else if (!limit) {
            length = matching.length;
        }

        return { length, records };
    }

    async readGroup(model, domain = [], fields = [], groupby = [], options = {}) {
        return this._group(model, domain, fields, groupby, options, false);
    }

    async webReadGroup(model, domain = [], fields = [], groupby = [], options = {}) {
        return this._group(model, domain, fields, groupby, options, true);
    }

    matchesDomain(record, domain = [], options = {}) {
        if (!domain || domain.length === 0) return true;
        const tokens = Array.isArray(domain) ? [...domain] : [];
        try {
            const [result, index] = this._evalExpression(record, tokens, 0, options);
            return Boolean(result) && index === tokens.length;
        } catch {
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
        if (Array.isArray(token)) return [this._compare(record, token, options), index + 1];

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

        if (op === "=?") {
            return expected === false || expected === null || expected === undefined || this._equals(left, expected);
        }
        if (op === "in" || op === "not in") {
            const values = Array.isArray(expected) ? expected : [expected];
            const found = this._membership(left, values);
            return op === "in" ? found : !found;
        }
        if (op === "=" || op === "==") return this._equals(left, expected);
        if (op === "!=" || op === "<>") return !this._equals(left, expected);
        if (["like", "ilike", "not like", "not ilike", "=like", "=ilike"].includes(op)) {
            const source = String(left ?? "");
            const needle = String(expected ?? "");
            const insensitive = op.includes("ilike");
            const pattern = insensitive ? needle.toLowerCase() : needle;
            const haystack = insensitive ? source.toLowerCase() : source;
            const found = this._like(haystack, pattern, op.startsWith("=") || op.includes("like"));
            return op.startsWith("not ") ? !found : found;
        }
        if ([">", ">=", "<", "<=", "in", "not in"].includes(op)) {
            const a = this._sortable(left);
            const b = this._sortable(expected);
            if (a === null || b === null) return false;
            if (op === ">") return a > b;
            if (op === ">=") return a >= b;
            if (op === "<") return a < b;
            if (op === "<=") return a <= b;
        }
        throw new Error(`Unsupported offline domain operator: ${operator}`);
    }

    _like(value, pattern, exactPattern) {
        if (!pattern) return true;
        if (exactPattern && !pattern.includes("%") && !pattern.includes("_")) return value.includes(pattern);
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`^${escaped.replaceAll("%", ".*").replaceAll("_", ".")}$`);
        return regex.test(value);
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
            if (Array.isArray(actual) && Array.isArray(expected)) {
                return actual.length === expected.length && actual.every((v, i) => this._equals(v, expected[i]));
            }
            return false;
        }
        return actual === expected || String(actual ?? "") === String(expected ?? "");
    }

    _membership(actual, expected) {
        if (Array.isArray(actual)) return actual.some((value) => expected.some((item) => this._equals(value, item)));
        return expected.some((item) => this._equals(actual, item));
    }

    _sortable(value) {
        if (value === MISSING || value === null || value === undefined || value === false) return null;
        if (Array.isArray(value)) return value.length ? this._sortable(value[0]) : null;
        if (typeof value === "object") return this._sortable(value.id ?? value.display_name);
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

    async projectSpecification(model, record, specification = {}, options = {}) {
        const result = { id: this.identity(record) };
        if (!specification || Object.keys(specification).length === 0) return result;

        for (const [fieldName, fieldSpecRaw] of Object.entries(specification)) {
            const fieldSpec = isObject(fieldSpecRaw) ? fieldSpecRaw : {};
            const field = await this.getFieldMetadata(model, fieldName);
            if (!field) continue;
            const value = Object.prototype.hasOwnProperty.call(record.values || {}, fieldName)
                ? record.values[fieldName]
                : null;
            result[fieldName] = await this.projectRelationalValue(field, value, fieldSpec, options);
        }
        return result;
    }

    async projectRelationalValue(field, value, specification, options) {
        if (field.type === "many2one") {
            if (!value) return false;
            const id = this.relationId(value);
            if (!specification.fields) return id;
            const related = await this.database.getRecord(field.relation, id);
            if (!related) return false;
            const nested = await this.projectSpecification(field.relation, related, specification.fields, options);
            if (specification.fields.display_name !== undefined && nested.display_name === undefined) {
                nested.display_name = this.displayName(related);
            }
            return nested;
        }

        if (field.type === "many2many" || field.type === "one2many") {
            if (!specification || Object.keys(specification).length === 0) return undefined;
            let ids = await this.relationIds(field, value);
            if (specification.order) {
                const relatedRecords = await this.database.findRecords(field.relation);
                const selected = relatedRecords.filter((record) => ids.includes(this.identity(record)));
                ids = this.orderRecords(selected, specification.order).map((record) => this.identity(record));
            }
            if (!specification.fields) return ids;
            const records = await this.database.findRecords(field.relation);
            const byId = new Map(records.map((record) => [this.identity(record), record]));
            return Promise.all(ids.map((id) => {
                const related = byId.get(id);
                return related ? this.projectSpecification(field.relation, related, specification.fields, options) : null;
            })).then((values) => values.filter(Boolean));
        }
        return value;
    }

    async relationIds(field, value) {
        if (field.type === "one2many") {
            const parentIds = Array.isArray(value) ? value.map((item) => this.relationId(item)) : [];
            return parentIds;
        }
        if (!Array.isArray(value)) return value ? [this.relationId(value)] : [];
        return value.map((item) => this.relationId(item)).filter((id) => id !== false && id !== null && id !== undefined);
    }

    relationId(value) {
        if (Array.isArray(value)) return value[0];
        if (isObject(value)) return value.id ?? value.server_id ?? value.local_id;
        return value;
    }

    displayName(record) {
        return record.values?.display_name ?? record.values?.name ?? record.values?.complete_name ?? String(this.identity(record));
    }

    async getFieldMetadata(model, fieldName) {
        const fields = this.metadata?.[model] || await this.database.getMetadata("fields", model) || {};
        return fields[fieldName] || null;
    }

    async _group(model, domain, fields, groupby, options, webFormat) {
        const records = (await this.database.findRecords(model)).filter((record) => this.matchesDomain(record, domain, options));
        const groupFieldNames = (groupby || []).map((group) => String(group).split(":")[0]);
        if (!groupFieldNames.length) {
            return webFormat ? { groups: [], length: 0 } : [];
        }

        const groups = new Map();
        for (const record of records) {
            const keyParts = groupFieldNames.map((fieldName) => this.groupValue(record, fieldName));
            const key = JSON.stringify(keyParts);
            if (!groups.has(key)) groups.set(key, { keyParts, records: [] });
            groups.get(key).records.push(record);
        }

        const output = [];
        for (const group of groups.values()) {
            const row = {};
            groupFieldNames.forEach((fieldName, index) => {
                row[fieldName] = this.groupReadValue(group.keyParts[index]);
            });
            row.__count = group.records.length;
            row.__domain = this.buildGroupDomain(groupFieldNames, group.keyParts);
            this.applyAggregates(row, group.records, fields);
            if (webFormat) row.__fold = false;
            output.push(row);
        }

        const ordered = this.orderGroupRows(output, options.orderby || options.order);
        const offset = Number.isInteger(options.offset) ? options.offset : 0;
        const limit = options.limit === undefined ? undefined : Number(options.limit);
        const sliced = limit === undefined || limit < 0 ? ordered.slice(offset) : ordered.slice(offset, offset + limit);
        return webFormat ? { groups: sliced, length: ordered.length } : sliced;
    }

    groupValue(record, fieldName) {
        const value = this._getFieldValue(record, fieldName);
        if (value === MISSING || value === false || value === null || value === undefined) return false;
        if (Array.isArray(value)) return value.map((item) => this.relationId(item));
        return this.relationId(value);
    }

    groupReadValue(value) {
        if (Array.isArray(value)) return value;
        return value;
    }

    buildGroupDomain(fields, values) {
        return fields.map((field, index) => [field, "=", values[index]]);
    }

    applyAggregates(row, records, fields = []) {
        for (const fieldSpec of fields || []) {
            const match = String(fieldSpec).match(/^([\w.]+)(?::(\w+)(?:\((\w+)\))?)?$/);
            if (!match) continue;
            const [, field, aggregate = "count", operand] = match;
            if (field.includes(".")) continue;
            const values = records.map((record) => this._getFieldValue(record, operand || field)).filter((value) => value !== MISSING && value !== false && value !== null && value !== undefined);
            const key = `${field}${aggregate !== "count" ? `:${aggregate}` : ""}`;
            if (aggregate === "count") row[key] = records.length;
            else if (aggregate === "sum") row[key] = values.reduce((sum, value) => sum + Number(value || 0), 0);
            else if (aggregate === "avg") row[key] = values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
            else if (aggregate === "min") row[key] = values.length ? Math.min(...values.map(Number)) : false;
            else if (aggregate === "max") row[key] = values.length ? Math.max(...values.map(Number)) : false;
        }
    }

    orderGroupRows(rows, order = "") {
        if (!order) return rows;
        const clauses = String(order).split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
            const pieces = part.split(/\s+/);
            return { field: pieces[0], descending: pieces[1]?.toLowerCase() === "desc" };
        });
        return [...rows].sort((a, b) => {
            for (const clause of clauses) {
                const av = this._sortable(a[clause.field]);
                const bv = this._sortable(b[clause.field]);
                if (av === bv) continue;
                if (av === null) return clause.descending ? 1 : -1;
                if (bv === null) return clause.descending ? -1 : 1;
                return av < bv ? (clause.descending ? 1 : -1) : (clause.descending ? -1 : 1);
            }
            return 0;
        });
    }

    project(record, fields = [], _options = {}) {
        const result = { id: this.identity(record) };
        if (!fields || fields.length === 0) return { ...record.values, id: result.id };
        for (const field of fields) {
            if (Object.prototype.hasOwnProperty.call(record.values, field)) result[field] = record.values[field];
        }
        return result;
    }
}
