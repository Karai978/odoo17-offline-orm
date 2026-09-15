/** @odoo-module **/

/**
 * Native-compatible menu service with an IndexedDB fallback.
 *
 * Online behaviour remains Odoo's native /web/webclient/load_menus response.
 * Offline behaviour reuses the last complete menu tree captured while online.
 */

import { browser } from "@web/core/browser/browser";
import { registry } from "@web/core/registry";
import { session } from "@web/session";
import { OfflineDatabase } from "./offline_database";

const loadMenusUrl = "/web/webclient/load_menus";

function isConnectionLoss(error) {
    return (
        error?.name === "ConnectionLostError" ||
        error?.constructor?.name === "ConnectionLostError" ||
        error?.code === "CONNECTION_LOST"
    );
}

function makeMenus(env, menusData, fetchLoadMenus) {
    let currentAppId;

    function getMenu(menuId) {
        return menusData[menuId];
    }

    function updateURL(menuId) {
        env.services.router.pushState({ menu_id: menuId }, { lock: true });
    }

    function setCurrentMenu(menu, update = true) {
        menu = typeof menu === "number" ? getMenu(menu) : menu;
        if (menu && menu.appID !== currentAppId) {
            currentAppId = menu.appID;
            env.bus.trigger("MENUS:APP-CHANGED");
            if (update) updateURL(menu.id);
        }
    }

    return {
        getAll() {
            return Object.values(menusData);
        },
        getApps() {
            const root = getMenu("root");
            return root?.children?.map((id) => getMenu(id)).filter(Boolean) || [];
        },
        getMenu,
        getCurrentApp() {
            return currentAppId ? getMenu(currentAppId) : undefined;
        },
        getMenuAsTree(menuID) {
            const menu = getMenu(menuID);
            if (!menu) return undefined;
            if (!menu.childrenTree) {
                menu.childrenTree = (menu.children || [])
                    .map((id) => this.getMenuAsTree(id))
                    .filter(Boolean);
            }
            return menu;
        },
        async selectMenu(menu) {
            menu = typeof menu === "number" ? getMenu(menu) : menu;
            if (!menu?.actionID) return;
            await env.services.action.doAction(menu.actionID, {
                clearBreadcrumbs: true,
                onActionReady: () => setCurrentMenu(menu, false),
            });
            updateURL(menu.id);
        },
        setCurrentMenu: (menu) => setCurrentMenu(menu),
        async reload() {
            if (fetchLoadMenus) {
                menusData = await fetchLoadMenus(true);
                env.bus.trigger("MENUS:APP-CHANGED");
            }
        },
    };
}

export const offlineMenuService = {
    dependencies: ["action", "router"],
    async start(env) {
        const database = new OfflineDatabase();
        await database.open();

        const cacheKey = "native_load_menus";
        const cacheHashes = session.cache_hashes || {};
        let loadMenusHash = cacheHashes.load_menus || new Date().getTime().toString();

        const fetchLoadMenus = async (reload = false) => {
            if (reload) loadMenusHash = new Date().getTime().toString();
            const response = await browser.fetch(`${loadMenusUrl}/${loadMenusHash}`);
            if (!response.ok) throw new Error("Error while fetching menus");
            const data = await response.json();
            await database.putMetadata("menus_native", cacheKey, data);
            return data;
        };

        let menusData;
        try {
            if (navigator.onLine === false) throw new Error("offline");
            menusData = await fetchLoadMenus(false);
        } catch (error) {
            if (!isConnectionLoss(error) && error.message !== "offline") {
                // A cached menu is still preferable to blocking the WebClient.
                menusData = await database.getMetadata("menus_native", cacheKey);
                if (!menusData) throw error;
            } else {
                menusData = await database.getMetadata("menus_native", cacheKey);
            }
        }

        if (!menusData) {
            throw new Error("Aucun menu Odoo n'est disponible hors ligne. Téléchargez une application pendant que vous êtes connecté.");
        }

        return makeMenus(env, menusData, fetchLoadMenus);
    },
};

registry.category("services").add("menu", offlineMenuService, { force: true });
