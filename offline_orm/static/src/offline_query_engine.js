/**
 * Generic local ORM query engine.
 *
 * The engine operates on canonical records and model/field metadata. It must
 * never contain Sales, Purchase, CRM, or other application-specific rules.
 */

export class OfflineQueryEngine {
    constructor({ database, metadata = null } = {}) {
        this.database = database;
        this.metadata = metadata;
    }

    async search(model, domain = [], options = {}) {
        const records = await this.database.findRecords(model);
        const matching = records.filter((record) => this.matchesDomain(record, domain, options));
        const ordered = this.orderRecords(matching, options.order);
        const offset = Number.isInteger(options.offset) ? options.offset : 0;
        const limit = Number.isInteger(options.limit) ? options.limit : undefined;
        const sliced = limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + limit);
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
            .filter((record) => !record.deleted && wanted.has(this.identity(record)))
            .map((record) => this.project(record, fields, options));
    }

    async searchRead(model, domain = [], fields = [], options = {}) {
        const ids = await this.search(model, domain, options);
        return this.read(model, ids, fields, options);
    }

    matchesDomain(_record, _domain, _options = {}) {
        // Domain evaluation is intentionally not approximated here. The next
        // implementation will cover Odoo operators and boolean domain syntax.
        return true;
    }

    orderRecords(records, _order) {
        // Ordering must be implemented from Odoo semantics before being used
        // for native list/search compatibility.
        return records;
    }

    identity(record) {
        return record.server_id ?? record.local_uuid;
    }

    project(record, fields, _options = {}) {
        if (!fields || fields.length === 0) {
            return { ...record.values, id: this.identity(record) };
        }
        const result = { id: this.identity(record) };
        for (const field of fields) {
            if (Object.prototype.hasOwnProperty.call(record.values, field)) {
                result[field] = record.values[field];
            }
        }
        return result;
    }
}
