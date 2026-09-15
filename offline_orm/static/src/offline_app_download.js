/**
 * Generic Odoo 17 App Download Engine.
 *
 * Selects an installed Odoo application and asks the generic bootstrap engine
 * to materialize the application's metadata and business-data dependency
 * closure in IndexedDB. No business application is hard-coded here.
 */

function normalizeAppName(app) {
    if (typeof app !== "string") return "";
    return app.trim().toLowerCase();
}

function actionId(value) {
    if (typeof value === "string") {
        const match = value.match(/^ir\.actions\.[^,]+,(\d+)$/);
        return match ? Number(match[1]) : null;
    }
    if (Array.isArray(value) && Number.isInteger(value[0])) return value[0];
    return null;
}

function moduleFromXmlId(xmlId) {
    if (typeof xmlId !== "string") return null;
    const separator = xmlId.indexOf(".");
    return separator > 0 ? xmlId.slice(0, separator) : null;
}

export class OfflineAppDownloadEngine {
    constructor({ orm, bootstrap }) {
        this.orm = orm;
        this.bootstrap = bootstrap;
        this.database = bootstrap.database;
    }

    /**
     * Return installed Odoo applications that can be offered to the user.
     * The application list comes from Odoo itself; no module names are coded.
     */
    async discoverApps() {
        const modules = await this.orm.searchRead(
            "ir.module.module",
            [["state", "=", "installed"], ["application", "=", true]],
            ["name", "shortdesc", "state", "application"],
            { order: "shortdesc,name", limit: 0 },
        );

        const menuData = await this.orm.searchRead(
            "ir.model.data",
            [["model", "=", "ir.ui.menu"]],
            ["module", "name", "res_id"],
            { limit: 0 },
        );
        const menusByModule = new Map();
        for (const row of menuData) {
            const list = menusByModule.get(row.module) || [];
            list.push(row.res_id);
            menusByModule.set(row.module, list);
        }

        return modules.map((module) => ({
            technical_name: module.name,
            name: module.shortdesc || module.name,
            installed: true,
            menu_ids: menusByModule.get(module.name) || [],
        }));
    }

    /**
     * Download one installed application.
     *
     * `app` may be the technical module name (recommended) or its displayed
     * name. The selected module's menus/actions determine the root models;
     * the generic bootstrap then follows model relations dynamically.
     */
    async downloadApp(app, options = {}) {
        const requested = normalizeAppName(app);
        if (!requested) throw new Error("An Odoo application is required");

        const apps = await this.discoverApps();
        const selected = apps.find((item) =>
            normalizeAppName(item.technical_name) === requested ||
            normalizeAppName(item.name) === requested
        );
        if (!selected) {
            throw new Error(`Installed Odoo application not found: ${app}`);
        }

        const menuIds = selected.menu_ids.filter((id) => Number.isInteger(id));
        let rootModels = [];
        let actions = [];

        if (menuIds.length) {
            const menus = await this.orm.searchRead(
                "ir.ui.menu",
                [["id", "in", menuIds]],
                ["id", "name", "parent_id", "action", "sequence", "active", "web_icon"],
                { limit: menuIds.length },
            );
            const actionIds = [...new Set(
                menus.map((menu) => actionId(menu.action)).filter(Number.isInteger)
            )];

            if (actionIds.length) {
                actions = await this.orm.searchRead(
                    "ir.actions.act_window",
                    [["id", "in", actionIds]],
                    [
                        "id", "name", "type", "res_model", "view_mode", "views", "view_id",
                        "search_view_id", "domain", "context", "limit", "target", "res_id", "help",
                    ],
                    { limit: actionIds.length },
                );
                rootModels = [...new Set(actions.map((action) => action.res_model).filter(Boolean))];
            }
        }

        // Fallback: some applications expose actions without a menu XML record
        // belonging directly to the module. Use the application's technical
        // name to identify compatible menu icons before giving up.
        if (!rootModels.length) {
            const menus = await this.orm.searchRead(
                "ir.ui.menu",
                [["web_icon", "ilike", `${selected.technical_name}/`]],
                ["id", "action"],
                { limit: 0 },
            );
            const actionIds = [...new Set(
                menus.map((menu) => actionId(menu.action)).filter(Number.isInteger)
            )];
            if (actionIds.length) {
                actions = await this.orm.searchRead(
                    "ir.actions.act_window",
                    [["id", "in", actionIds]],
                    ["id", "name", "type", "res_model", "view_mode", "views", "view_id", "search_view_id", "domain", "context", "limit", "target", "res_id", "help"],
                    { limit: actionIds.length },
                );
                rootModels = [...new Set(actions.map((action) => action.res_model).filter(Boolean))];
            }
        }

        if (!rootModels.length) {
            throw new Error(`No window-action model could be discovered for application: ${selected.name}`);
        }

        const report = await this.bootstrap.run({
            ...options,
            models: rootModels,
            // 0 means unlimited in OfflineBootstrap: download every record
            // returned by the current user's Odoo ORM permissions.
            maxRecordsPerModel: options.maxRecordsPerModel ?? 0,
            // Follow relations so forms, relational fields and line records
            // are available without requiring prior online navigation.
            relationDepth: options.relationDepth ?? 2,
        });

        const appReport = {
            application: selected,
            root_models: rootModels,
            root_actions: actions,
            bootstrap: report,
            downloaded_at: new Date().toISOString(),
        };
        await this.database.putMetadata("applications", selected.technical_name, appReport);
        return appReport;
    }

    async isDownloaded(app) {
        const requested = normalizeAppName(app);
        const apps = await this.discoverApps();
        const selected = apps.find((item) =>
            normalizeAppName(item.technical_name) === requested ||
            normalizeAppName(item.name) === requested
        );
        if (!selected) return false;
        return Boolean(await this.database.getMetadata("applications", selected.technical_name));
    }
}

export const offlineAppDownloadService = {
    dependencies: ["orm", "offline_bootstrap"],
    start(env, { orm, offline_bootstrap: bootstrap }) {
        return new OfflineAppDownloadEngine({ orm, bootstrap });
    },
};
