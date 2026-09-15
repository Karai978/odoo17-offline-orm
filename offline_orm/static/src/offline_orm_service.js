/**
 * Odoo 17 Offline ORM service.
 *
 * This is a native ORM-compatible facade. It keeps the WebClient contract and
 * routes each operation to native RPC or the local IndexedDB engine.
 */

import { ConnectionRouter } from "./connection_router";
import { OfflineDatabase, RECORD_SYNC_STATE } from "./offline_database";
import { OfflineQueryEngine } from "./offline_query_engine";

function validateModel(model) {
    if (typeof model !== "string" || !model) throw new Error("Invalid model name");
}

function mergeContext(base, extra = {}) {
    return { ...(base || {}), ...(extra || {}) };
}

function normalizeIds(ids) {
    return Array.isArray(ids) ? ids : [ids];
}

function fieldsFromSpecification(specification) {
    if (!specification) return [];
    if (Array.isArray(specification)) return specification;
    if (typeof specification === "object") {
        return Object.entries(specification)
            .filter(([, value]) => value !== false && value !== null)
            .map(([field]) => field);
    }
    return [];
}

function rpcOptions(options = {}, context) {
    return {
        ...options,
        context: mergeContext(context, options.context),
    };
}

class OfflineORM {
    constructor({ env, rpc, user, database, queryEngine, router, context = null }) {
        this.env = env;
        this.rpc = rpc;
        this.user = user;
        this.database = database;
        this.queryEngine = queryEngine;
        this.router = router;
        this._context = context || { ...(user.context || {}) };
    }

    get context() {
        return { ...this._context };
    }

    withContext(additionalContext = {}) {
        return new OfflineORM({
            env: this.env,
            rpc: this.rpc,
            user: this.user,
            database: this.database,
            queryEngine: this.queryEngine,
            router: this.router,
            context: mergeContext(this._context, additionalContext),
        });
    }

    async call(model, method, args = [], kwargs = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/${method}`, {
                model,
                method,
                args,
                kwargs: rpcOptions(kwargs, this._context),
            }, { silent: false }),
            offline: () => {
                throw this._unsupported("call", `${model}.${method}`);
            },
        });
    }

    async create(model, values, options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/create`, {
                model,
                method: "create",
                args: [values],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: async () => {
                const record = await this._createLocal(model, values);
                return record.local_id;
            },
        });
    }

    async read(model, ids, fields, options = {}) {
        validateModel(model);
        const normalizedIds = normalizeIds(ids);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/read`, {
                model,
                method: "read",
                args: [normalizedIds, fields],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: () => this.queryEngine.read(model, normalizedIds, fields, options),
        });
    }

    async write(model, ids, values, options = {}) {
        validateModel(model);
        const normalizedIds = normalizeIds(ids);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/write`, {
                model,
                method: "write",
                args: [normalizedIds, values],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: async () => {
                for (const id of normalizedIds) await this._writeLocal(model, id, values);
                return true;
            },
        });
    }

    async unlink(model, ids, options = {}) {
        validateModel(model);
        const normalizedIds = normalizeIds(ids);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/unlink`, {
                model,
                method: "unlink",
                args: [normalizedIds],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: async () => {
                for (const id of normalizedIds) await this._unlinkLocal(model, id);
                return true;
            },
        });
    }

    async search(model, domain = [], options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/search`, {
                model,
                method: "search",
                args: [domain],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: () => this.queryEngine.search(model, domain, options),
        });
    }

    async searchRead(model, domain = [], fields = [], options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/search_read`, {
                model,
                method: "search_read",
                args: [domain, fields],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: () => this.queryEngine.searchRead(model, domain, fields, options),
        });
    }

    async searchCount(model, domain = [], options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/search_count`, {
                model,
                method: "search_count",
                args: [domain],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: () => this.queryEngine.searchCount(model, domain, options),
        });
    }

    async readGroup(model, domain, fields, groupby, options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/read_group`, {
                model,
                method: "read_group",
                args: [domain, fields, groupby],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: () => { throw this._unsupported("readGroup"); },
        });
    }

    async webReadGroup(model, domain, fields, groupby, options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_read_group`, {
                model,
                method: "web_read_group",
                args: [domain, fields, groupby],
                kwargs: rpcOptions(options, this._context),
            }, { silent: false }),
            offline: () => { throw this._unsupported("webReadGroup"); },
        });
    }

    async webRead(model, ids, specification, context = {}) {
        validateModel(model);
        const normalizedIds = normalizeIds(ids);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_read`, {
                model,
                method: "web_read",
                args: [normalizedIds, specification],
                kwargs: { context: mergeContext(this._context, context) },
            }, { silent: false }),
            offline: () => this.queryEngine.read(model, normalizedIds, fieldsFromSpecification(specification), { context: mergeContext(this._context, context) }),
        });
    }

    async webSearchRead(model, domain, specification, context = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_search_read`, {
                model,
                method: "web_search_read",
                args: [],
                kwargs: { domain, specification, context: mergeContext(this._context, context) },
            }, { silent: false }),
            offline: async () => {
                const fields = fieldsFromSpecification(specification);
                const options = specification?.limit !== undefined ? { limit: specification.limit } : {};
                return this.queryEngine.searchRead(model, domain || [], fields, options);
            },
        });
    }

    async webSave(model, id, values, specification, context = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_save`, {
                model,
                method: "web_save",
                args: [[id], values],
                kwargs: { specification, context: mergeContext(this._context, context) },
            }, { silent: false }),
            offline: async () => {
                const identity = id ?? (await this._createLocal(model, values)).local_id;
                if (id !== undefined && id !== null) await this._writeLocal(model, id, values);
                return this.webRead(model, [identity], specification, context);
            },
        });
    }

    async nameGet(model, ids, context = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/name_get`, {
                model, method: "name_get", args: [normalizeIds(ids)], kwargs: { context: mergeContext(this._context, context) },
            }, { silent: false }),
            offline: async () => {
                const records = await this.queryEngine.read(model, normalizeIds(ids), ["display_name", "name"]);
                return records.map((record) => [record.id, record.display_name ?? record.name ?? String(record.id)]);
            },
        });
    }

    async nameSearch(model, name = "", domain = [], operator = "ilike", limit = 100, context = {}) {
        const searchDomain = name ? [...(domain || []), ["display_name", operator, name]] : (domain || []);
        const ids = await this.search(model, searchDomain, { limit, context });
        return this.nameGet(model, ids, context);
    }

    async nameCreate(model, name, context = {}) {
        return this.create(model, { name }, { context });
    }

    async onchange(model, ids, values, fieldName, specification, context = {}) {
        return this.call(model, "onchange", [normalizeIds(ids), values, fieldName, specification], { context });
    }

    async defaultGet(model, fields, context = {}) {
        return this.call(model, "default_get", [fields], { context });
    }

    async fieldsGet(model, attributes = [], context = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/fields_get`, {
                model, method: "fields_get", args: [attributes], kwargs: { context: mergeContext(this._context, context) },
            }, { silent: false }),
            offline: async () => (await this.database.getMetadata("fields", model)) || {},
        });
    }

    async getViews(model, views, options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/get_views`, {
                model, method: "get_views", args: [], kwargs: { ...options, views, context: mergeContext(this._context, options.context) },
            }, { silent: false }),
            offline: async () => (await this.database.getMetadata("views", model)) || {},
        });
    }

    async transaction(callback) {
        await this.database.open();
        return callback(this);
    }

    async _createLocal(model, values) {
        const localUUID = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const record = await this.database.putRecord({
            model,
            local_uuid: localUUID,
            local_id: this.database.allocateLocalId(),
            server_id: null,
            values,
            sync_state: RECORD_SYNC_STATE.PENDING_CREATE,
        });
        await this.database.enqueue({
            local_uuid: localUUID,
            model,
            operation: "create",
            payload: { values },
        });
        return record;
    }

    async _writeLocal(model, identity, values) {
        const record = await this.database.getRecord(model, identity);
        if (!record) throw new Error(`Offline record not found: ${model}/${identity}`);
        record.values = { ...record.values, ...values };
        record.sync_state = record.sync_state === RECORD_SYNC_STATE.PENDING_CREATE
            ? RECORD_SYNC_STATE.PENDING_CREATE
            : RECORD_SYNC_STATE.PENDING_WRITE;
        record.updated_at = new Date().toISOString();
        await this.database.putRecord(record);
        await this.database.enqueue({
            local_uuid: `${record.local_uuid}:write:${record.version + 1}`,
            model,
            operation: "write",
            payload: { id: record.server_id ?? record.local_id, values },
            reference_write_date: record.write_date,
        });
        return true;
    }

    async _unlinkLocal(model, identity) {
        const record = await this.database.getRecord(model, identity);
        if (!record) throw new Error(`Offline record not found: ${model}/${identity}`);
        record.deleted = true;
        record.sync_state = RECORD_SYNC_STATE.PENDING_DELETE;
        record.updated_at = new Date().toISOString();
        await this.database.putRecord(record);
        if (record.server_id !== null && record.server_id !== undefined) {
            await this.database.enqueue({
                local_uuid: `${record.local_uuid}:unlink`,
                model,
                operation: "unlink",
                payload: { id: record.server_id },
            });
        }
        return true;
    }

    _unsupported(method, detail = "") {
        const suffix = detail ? ` (${detail})` : "";
        const error = new Error(`Unsupported offline ORM operation: ${method}${suffix}`);
        error.code = "OFFLINE_UNSUPPORTED";
        error.method = method;
        return error;
    }
}

export const offlineOrmService = {
    dependencies: ["rpc", "user"],

    async start(env, { rpc, user }) {
        const database = new OfflineDatabase();
        const queryEngine = new OfflineQueryEngine({ database });
        const router = new ConnectionRouter({ rpc, local: queryEngine });
        await database.open();
        return new OfflineORM({ env, rpc, user, database, queryEngine, router });
    },
};
