/** @odoo-module **/

/**
 * Offline-aware RPC transport for native Odoo services which do not go
 * through the ORM service (notably action loading).
 *
 * The native WebClient continues to call the service named "rpc". We only
 * provide local answers for requests for which this addon has a canonical
 * cache; every other request keeps the native RPC behaviour.
 */

import { rpcService as nativeRpcService } from "@web/core/network/rpc_service";
import { OfflineDatabase } from "./offline_database";

function isConnectionLoss(error) {
    return (
        error?.name === "ConnectionLostError" ||
        error?.constructor?.name === "ConnectionLostError" ||
        error?.code === "CONNECTION_LOST"
    );
}

function isOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
}

function actionIdFromRequest(params = {}) {
    const value = params.action_id;
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (Array.isArray(value) && Number.isInteger(value[0])) return value[0];
    if (typeof value === "string") {
        const match = value.match(/(\d+)$/);
        return match ? Number(match[1]) : null;
    }
    return null;
}

function normalizeAction(action) {
    if (!action) return null;
    return {
        ...action,
        type: action.type || "ir.actions.act_window",
        views: Array.isArray(action.views) ? action.views : [],
        view_mode: action.view_mode || "list,form",
        context: action.context || "{}",
        domain: action.domain || "[]",
    };
}

async function getCachedAction(database, actionId) {
    if (!Number.isInteger(actionId)) return null;

    const direct = await database.getMetadata("action_load", String(actionId));
    if (direct) return normalizeAction(direct);

    const actions = await database.getMetadata("actions", "window");
    const action = Array.isArray(actions)
        ? actions.find((item) => Number(item.id) === actionId)
        : null;
    return normalizeAction(action);
}

async function getCachedVersionInfo(database) {
    return (await database.getMetadata("webclient", "version_info")) || {
        server_version: "17.0",
        server_version_info: [17, 0, 0, "final", 0, ""],
    };
}

export const offlineRpcService = {
    async: true,
    start(env) {
        const nativeRpc = nativeRpcService.start(env);
        const database = new OfflineDatabase();

        return async function rpc(route, params = {}, settings = {}) {
            // These are native WebClient probes, not business operations. They
            // must not turn an already-loaded client into an error state when
            // the connection disappears.
            if (isOffline()) {
                if (route === "/web/session/check") {
                    return null;
                }
                if (route === "/web/webclient/version_info") {
                    return getCachedVersionInfo(database);
                }
                if (route === "/web/action/load") {
                    const action = await getCachedAction(database, actionIdFromRequest(params));
                    if (action) return action;
                }
            }

            try {
                const result = await nativeRpc(route, params, settings);

                if (route === "/web/action/load") {
                    const actionId = actionIdFromRequest(params);
                    if (Number.isInteger(actionId)) {
                        await database.putMetadata("action_load", String(actionId), result);
                    }
                }
                if (route === "/web/webclient/version_info" && result) {
                    await database.putMetadata("webclient", "version_info", result);
                }
                return result;
            } catch (error) {
                if (!isConnectionLoss(error)) throw error;

                if (route === "/web/action/load") {
                    const action = await getCachedAction(database, actionIdFromRequest(params));
                    if (action) return action;
                }

                if (route === "/web/session/check") {
                    return null;
                }

                if (route === "/web/webclient/version_info") {
                    return getCachedVersionInfo(database);
                }

                throw error;
            }
        };
    },
};
