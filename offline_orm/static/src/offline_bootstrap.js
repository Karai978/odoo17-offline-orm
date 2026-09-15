/** @odoo-module **/

/**
 * Connected Odoo 17 -> metadata/security/business snapshot -> IndexedDB.
 * Native WebClient/services remain the consumers; this file only downloads.
 */

const DEFAULTS = Object.freeze({
    pageSize: 200,
    maxRecordsPerModel: 1000,
    relationDepth: 1,
    includeMenus: true,
    includeActions: true,
    includeViews: true,
    includeAccessRights: true,
    includeBusinessData: true,
    includeBinary: false,
    models: [],
});

const RELATIONS = new Set(["many2one", "many2many", "one2many"]);
const DATA_TYPES = new Set([
    "boolean", "char", "date", "datetime", "float", "html", "integer",
    "monetary", "selection", "text", "many2one", "many2many", "one2many", "reference",
]);

const unique = (values) => [...new Set(values.filter((v) => v !== null && v !== undefined))];

function actionId(value) {
    if (typeof value === "string") {
        const match = value.match(/^ir\.actions\.[^,]+,(\d+)$/);
        return match ? Number(match[1]) : null;
    }
    if (Array.isArray(value) && Number.isInteger(value[0])) return value[0];
    return null;
}

function dataFields(fields, includeBinary) {
    return Object.entries(fields)
        .filter(([name, field]) => {
            if (name === "id" || name === "display_name") return true;
            if (!field || !DATA_TYPES.has(field.type)) return false;
            if (!includeBinary && field.type === "binary") return false;
            return field.readable !== false;
        })
        .map(([name]) => name);
}

function relationIds(records, fields) {
    const result = new Map();
    for (const [name, field] of Object.entries(fields)) {
        if (!RELATIONS.has(field.type) || !field.relation) continue;
        const ids = [];
        for (const record of records) {
            const value = record[name];
            if (field.type === "many2one") {
                const id = Array.isArray(value) ? value[0] : value;
                if (Number.isInteger(id) && id > 0) ids.push(id);
            } else if (Array.isArray(value)) {
                for (const item of value) {
                    const id = Array.isArray(item) ? item[0] : item;
                    if (Number.isInteger(id) && id > 0) ids.push(id);
                }
            }
        }
        if (ids.length) result.set(field.relation, unique([...(result.get(field.relation) || []), ...ids]));
    }
    return result;
}

export class OfflineBootstrap {
    constructor({ orm, user }) {
        this.orm = orm;
        this.user = user;
        this.database = orm.database;
    }

    async run(options = {}) {
        const cfg = { ...DEFAULTS, ...options };
        const report = {
            started_at: new Date().toISOString(),
            finished_at: null,
            context: { ...(this.user.context || {}) },
            models: [],
            errors: [],
            counts: { menus: 0, actions: 0, models: 0, records: 0 },
        };

        await this.database.putMetadata("user_context", "current", {
            ...this.user.context,
            userId: this.user.userId,
            partnerId: this.user.partnerId,
            lang: this.user.lang,
            tz: this.user.tz,
            db: this.user.db,
            companies: this.user.context?.allowed_company_ids || [],
        });

        let menus = [];
        let actions = [];
        if (cfg.includeMenus) {
            try {
                menus = await this._menus(report);
            } catch (error) {
                report.errors.push({ stage: "menus", message: error.message });
            }
            if (cfg.includeActions) {
                try {
                    actions = await this._actions(menus, report);
                } catch (error) {
                    report.errors.push({ stage: "actions", message: error.message });
                }
            }
        }

        const roots = unique(cfg.models?.length ? cfg.models : actions.map((a) => a.res_model));
        const queue = roots.map((model) => ({ model, ids: null, depth: 0 }));
        const done = new Set();

        while (queue.length) {
            const item = queue.shift();
            if (!item.model || done.has(item.model) || item.depth > cfg.relationDepth) continue;
            done.add(item.model);
            try {
                const result = await this._model(item.model, item.ids, cfg, actions);
                report.models.push(result);
                report.counts.models += 1;
                report.counts.records += result.records;
                for (const relation of result.relations) {
                    if (!done.has(relation.model)) queue.push({
                        model: relation.model,
                        ids: relation.ids,
                        depth: item.depth + 1,
                    });
                }
            } catch (error) {
                report.errors.push({ model: item.model, message: error.message });
            }
        }

        report.finished_at = new Date().toISOString();
        await this.database.putMetadata("bootstrap", "last_run", report);
        return report;
    }

    async _menus(report) {
        const menus = await this.orm.searchRead("ir.ui.menu", [],
            ["id", "name", "parent_id", "action", "sequence", "active", "web_icon"],
            { order: "parent_id,sequence,id", limit: 0 });
        await this.database.putMetadata("menus", "all", menus);
        report.counts.menus = menus.length;
        return menus;
    }

    async _actions(menus, report) {
        const ids = unique(menus.map((m) => actionId(m.action)).filter(Number.isInteger));
        if (!ids.length) {
            await this.database.putMetadata("actions", "window", []);
            return [];
        }
        const actions = await this.orm.searchRead("ir.actions.act_window", [["id", "in", ids]], [
            "id", "name", "type", "res_model", "view_mode", "views", "view_id",
            "search_view_id", "domain", "context", "limit", "target", "res_id", "help",
        ], { limit: ids.length });
        await this.database.putMetadata("actions", "window", actions);
        report.counts.actions = actions.length;
        return actions;
    }

    async _model(model, relationIdsForModel, cfg, actions) {
        const fields = await this.orm.fieldsGet(model);
        await this.database.putMetadata("fields", model, fields);

        let modelInfo = { model, name: model, state: null, transient: false };
        try {
            const modelRows = await this.orm.searchRead("ir.model", [["model", "=", model]],
                ["id", "name", "model", "state", "transient"], { limit: 1 });
            if (modelRows[0]) modelInfo = modelRows[0];
        } catch {
            // ir.model visibility is not required to bootstrap the actual model.
        }
        await this.database.putMetadata("models", model, modelInfo);

        const result = {
            model,
            model_info: modelInfo,
            fields_count: Object.keys(fields).length,
            records: 0,
            access: null,
            views: null,
            relations: [],
        };

        if (cfg.includeAccessRights) {
            result.access = await this._access(model);
            await this.database.putMetadata("access", model, result.access);
        }

        if (cfg.includeViews) {
            try {
                result.views = await this.orm.getViews(model, this._viewRequest(model, actions), {
                    context: this.user.context,
                });
                await this.database.putMetadata("views", model, result.views);
            } catch {
                result.views = null;
            }
        }

        if (!cfg.includeBusinessData || result.access?.read === false) return result;

        const fieldsToRead = dataFields(fields, cfg.includeBinary);
        const domain = relationIdsForModel?.length
            ? [["id", "in", relationIdsForModel]]
            : (cfg.domains?.[model] || []);
        const total = await this.orm.searchCount(model, domain);
        const target = Math.min(total, Math.max(0, cfg.maxRecordsPerModel) || total);
        const pageSize = Math.max(1, Math.min(cfg.pageSize, target || cfg.pageSize));
        const related = new Map();

        for (let offset = 0; offset < target;) {
            const limit = Math.min(pageSize, target - offset);
            const records = await this.orm.searchRead(model, domain, fieldsToRead, {
                offset, limit, order: cfg.orders?.[model] || "id",
            });
            if (!records.length) break;
            for (const record of records) await this._record(model, record, fields);
            for (const [relationModel, ids] of relationIds(records, fields)) {
                related.set(relationModel, unique([...(related.get(relationModel) || []), ...ids]));
            }
            offset += records.length;
            result.records = offset;
            if (records.length < limit) break;
        }

        result.relations = [...related.entries()].map(([modelName, ids]) => ({ model: modelName, ids }));
        return result;
    }

    _viewRequest(model, actions) {
        for (const action of actions) {
            if (action.res_model !== model) continue;
            const request = [];
            if (Array.isArray(action.views)) {
                for (const view of action.views) {
                    if (Array.isArray(view) && view.length >= 2) request.push([view[0] || false, view[1]]);
                }
            }
            if (action.search_view_id) {
                const id = Array.isArray(action.search_view_id) ? action.search_view_id[0] : action.search_view_id;
                if (id) request.push([id, "search"]);
            }
            if (request.length) return this._uniqueViews(request);
        }
        return [[false, "list"], [false, "form"], [false, "search"]];
    }

    _uniqueViews(views) {
        const seen = new Set();
        return views.filter(([id, type]) => {
            const key = `${id || 0}:${type}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async _access(model) {
        const access = {};
        for (const operation of ["read", "write", "create", "unlink"]) {
            try {
                access[operation] = Boolean(await this.orm.call(model, "check_access_rights", [operation, false]));
            } catch {
                access[operation] = false;
            }
        }
        return access;
    }

    async _record(model, record, fields) {
        const values = {};
        for (const [name, value] of Object.entries(record)) {
            if (name === "id") continue;
            const field = fields[name];
            if (field?.type === "many2one") {
                values[name] = Array.isArray(value) ? (value[0] || null) : (value || null);
            } else if (field?.type === "many2many" || field?.type === "one2many") {
                values[name] = Array.isArray(value)
                    ? value.map((v) => Array.isArray(v) ? v[0] : v).filter(Boolean)
                    : [];
            } else {
                values[name] = value;
            }
        }
        await this.database.putRecord({
            model,
            server_id: record.id,
            values,
            sync_state: "synced",
            deleted: false,
            write_date: record.write_date || null,
        });
    }
}

export const offlineBootstrapService = {
    dependencies: ["orm", "user"],
    start(env, { orm, user }) {
        return new OfflineBootstrap({ orm, user });
    },
};
