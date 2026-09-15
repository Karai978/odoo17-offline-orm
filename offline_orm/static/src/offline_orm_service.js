/** @odoo-module **/

/**
 * Odoo 17 Offline ORM service.
 *
 * Native ORM-compatible facade. The native WebClient remains the consumer;
 * this service only changes where the ORM operation is executed.
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

function rpcKwargs(options = {}, context) {
    return { ...options, context: mergeContext(context, options.context) };
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
                kwargs: rpcKwargs(kwargs, this._context),
            }, { silent: false }),
            offline: () => { throw this._unsupported("call", `${model}.${method}`); },
        });
    }

    async create(model, values, options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/create`, {
                model,
                method: "create",
                args: [Array.isArray(values) ? values : [values]],
                kwargs: rpcKwargs(options, this._context),
            }, { silent: false }),
            offline: async () => (await this._createLocal(model, values)).local_id,
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
                kwargs: rpcKwargs(options, this._context),
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
                kwargs: rpcKwargs(options, this._context),
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
                kwargs: rpcKwargs(options, this._context),
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
                kwargs: rpcKwargs(options, this._context),
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
                kwargs: rpcKwargs(options, this._context),
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
                kwargs: rpcKwargs(options, this._context),
            }, { silent: false }),
            offline: () => this.queryEngine.searchCount(model, domain, options),
        });
    }

    async readGroup(model, domain = [], fields = [], groupby = [], options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/read_group`, {
                model,
                method: "read_group",
                args: [domain, fields, groupby],
                kwargs: rpcKwargs(options, this._context),
            }, { silent: false }),
            offline: () => this.queryEngine.readGroup(model, domain, fields, groupby, options),
        });
    }

    async webReadGroup(model, domain = [], fields = [], groupby = [], options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_read_group`, {
                model,
                method: "web_read_group",
                args: [domain, fields, groupby],
                kwargs: rpcKwargs(options, this._context),
            }, { silent: false }),
            offline: () => this.queryEngine.webReadGroup(model, domain, fields, groupby, options),
        });
    }

    async webRead(model, ids, options = {}) {
        validateModel(model);
        const normalizedIds = normalizeIds(ids);
        const specification = options.specification || {};
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_read`, {
                model,
                method: "web_read",
                args: [normalizedIds, specification],
                kwargs: { context: mergeContext(this._context, options.context) },
            }, { silent: false }),
            offline: () => this.queryEngine.webRead(model, normalizedIds, specification, options),
        });
    }

    async webSearchRead(model, domain = [], options = {}) {
        validateModel(model);
        const specification = options.specification || {};
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_search_read`, {
                model,
                method: "web_search_read",
                args: [domain, specification],
                kwargs: {
                    offset: options.offset,
                    limit: options.limit,
                    order: options.order,
                    count_limit: options.count_limit,
                    context: mergeContext(this._context, options.context),
                },
            }, { silent: false }),
            offline: () => this.queryEngine.webSearchRead(model, domain, specification, options),
        });
    }

    async webSave(model, id, values, specification, options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/web_save`, {
                model,
                method: "web_save",
                args: [values, specification, id ?? undefined],
                kwargs: { context: mergeContext(this._context, options.context) },
            }, { silent: false }),
            offline: async () => {
                let identity = id;
                if (identity === undefined || identity === null) {
                    identity = (await this._createLocal(model, values)).local_id;
                } else {
                    await this._writeLocal(model, identity, values);
                }
                return this.webRead(model, [identity], {
                    specification,
                    context: options.context,
                });
            },
        });
    }

    async nameGet(model, ids, options = {}) {
        validateModel(model);
        const normalizedIds = normalizeIds(ids);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/name_get`, {
                model,
                method: "name_get",
                args: [normalizedIds],
                kwargs: rpcKwargs(options, this._context),
            }, { silent: false }),
            offline: async () => {
                const records = await this.queryEngine.read(model, normalizedIds, ["display_name", "name", "complete_name"]);
                return records.map((record) => [record.id, record.display_name ?? record.name ?? record.complete_name ?? String(record.id)]);
            },
        });
    }

    async nameSearch(model, name = "", domain = [], operator = "ilike", limit = 100, options = {}) {
        const searchDomain = name ? [...(domain || []), ["display_name", operator, name]] : (domain || []);
        const ids = await this.search(model, searchDomain, { limit, context: options.context });
        return this.nameGet(model, ids, options);
    }

    async nameCreate(model, name, options = {}) {
        return this.create(model, { name }, options);
    }

    async onchange(model, ids, values, fieldName, specification, options = {}) {
        return this.call(model, "onchange", [normalizeIds(ids), values, fieldName, specification], options);
    }

    async defaultGet(model, fields, options = {}) {
        return this.call(model, "default_get", [fields], options);
    }

    async fieldsGet(model, attributes = [], options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/fields_get`, {
                model,
                method: "fields_get",
                args: [attributes],
                kwargs: { context: mergeContext(this._context, options.context) },
            }, { silent: false }),
            offline: async () => (await this.database.getMetadata("fields", model)) || {},
        });
    }

    async getViews(model, views, options = {}) {
        validateModel(model);
        return this.router.execute({
            online: () => this.rpc(`/web/dataset/call_kw/${model}/get_views`, {
                model,
                method: "get_views",
                args: [views],
                kwargs: { ...options, context: mergeContext(this._context, options.context) },
            }, { silent: false }),
            offline: async () => (await this.database.getMetadata("views", model)) || {},
        });
    }

    async transaction(callback) {
        await this.database.open();
        return callback(this);
    }

    async _createLocal(model, values) {
        const localUUID = typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;
        const record = await this.database.putRecord({
            model,
            local_uuid: localUUID,
            local_id: this.database.allocateLocalId(),
            server_id: null,
            values: { ...(values || {}) },
            sync_state: RECORD_SYNC_STATE.PENDING_CREATE,
        });
        await this.database.enqueue({
            local_uuid: localUUID,
            model,
            operation: "create",
            payload: { values: { ...(values || {}) } },
        });
        return record;
    }

    async _writeLocal(model, identity, values) {
        const record = await this.database.getRecord(model, identity);
        if (!record) throw new Error(`Offline record not found: ${model}/${identity}`);
        record.values = { ...record.values, ...(values || {}) };
        record.version = (record.version || 0) + 1;
        record.sync_state = record.sync_state === RECORD_SYNC_STATE.PENDING_CREATE
            ? RECORD_SYNC_STATE.PENDING_CREATE
            : RECORD_SYNC_STATE.PENDING_WRITE;
        record.updated_at = new Date().toISOString();
        await this.database.putRecord(record);
        await this.database.enqueue({
            local_uuid: `${record.local_uuid}:write:${record.version}`,
            model,
            operation: "write",
            payload: { id: record.server_id ?? record.local_id, values: { ...(values || {}) } },
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
                local_uuid: `${record.local_uuid}:unlink:${record.version || 1}`,
                model,
                operation: "unlink",
                payload: { id: record.server_id },
            });
        }
        return true;
    }

    _unsupported(method, detail = "") {
        const error = new Error(`Unsupported offline ORM operation: ${method}${detail ? ` (${detail})` : ""}`);
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
