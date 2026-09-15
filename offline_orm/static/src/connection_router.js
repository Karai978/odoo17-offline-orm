/** @odoo-module **/

/**
 * Connection Router
 *
 * Decides whether an ORM operation uses the native RPC transport or the local
 * offline engine. navigator.onLine is advisory; transport errors are the
 * authoritative signal for automatic fallback.
 */

export const CONNECTION_MODE = Object.freeze({
    AUTO: "auto",
    ONLINE: "online",
    OFFLINE: "offline",
});

export class ConnectionRouter {
    constructor({ rpc, local, mode = CONNECTION_MODE.AUTO } = {}) {
        this.rpc = rpc;
        this.local = local;
        this.mode = mode;
        this.lastTransportFailure = null;
    }

    setMode(mode) {
        if (!Object.values(CONNECTION_MODE).includes(mode)) {
            throw new Error(`Invalid connection mode: ${mode}`);
        }
        this.mode = mode;
    }

    getMode() {
        return this.mode;
    }

    isLikelyOnline() {
        return typeof navigator === "undefined" || navigator.onLine !== false;
    }

    /**
     * Execute a logical ORM operation.
     *
     * `online` and `offline` are callbacks so this router does not know the
     * details of either RPC or IndexedDB.
     */
    async execute({ online, offline }) {
        if (this.mode === CONNECTION_MODE.OFFLINE) {
            return offline();
        }

        if (this.mode === CONNECTION_MODE.ONLINE) {
            return online();
        }

        try {
            return await online();
        } catch (error) {
            if (!this._isConnectionLoss(error)) {
                throw error;
            }

            this.lastTransportFailure = error;
            return offline();
        }
    }

    _isConnectionLoss(error) {
        // The final implementation should import/use Odoo's native
        // ConnectionLostError. This fallback keeps the standalone module
        // independent until Odoo integration is enabled.
        return (
            error?.name === "ConnectionLostError" ||
            error?.constructor?.name === "ConnectionLostError" ||
            error?.code === "CONNECTION_LOST"
        );
    }
}
