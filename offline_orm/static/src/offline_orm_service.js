/**
 * Odoo 17 Offline ORM — service facade.
 *
 * This first version is intentionally a contract boundary. Business/query
 * implementation belongs to the router, query engine and database layers.
 *
 * IMPORTANT: this file is not wired into an Odoo installation yet. Integration
 * is deliberately kept separate until the standalone contract is validated.
 */

/**
 * Native Odoo service shape:
 *
 * {
 *     dependencies: ["rpc", "user"],
 *     start(env, { rpc, user }) { ... }
 * }
 */

export const offlineOrmService = {
    dependencies: ["rpc", "user"],

    start(env, { rpc, user }) {
        const context = () => ({ ...(user.context || {}) });

        const unsupported = (method) => {
            throw new Error(`Offline ORM method not implemented yet: ${method}`);
        };

        return {
            /** Native user context. */
            get context() {
                return context();
            },

            /**
             * Router/query/database integration will be attached here after
             * the contract is validated. Keeping the public facade explicit
             * prevents callers from depending on internal storage details.
             */
            call(model, method, args = [], kwargs = {}) {
                // Arbitrary Python methods are not safely reproducible offline.
                // Online dispatch is intentionally the first implementation.
                return rpc(
                    `/web/dataset/call_kw/${model}/${method}`,
                    {
                        model,
                        method,
                        args,
                        kwargs: {
                            ...kwargs,
                            context: {
                                ...context(),
                                ...(kwargs.context || {}),
                            },
                        },
                    },
                    { silent: false },
                );
            },

            create: (...args) => unsupported("create"),
            read: (...args) => unsupported("read"),
            write: (...args) => unsupported("write"),
            unlink: (...args) => unsupported("unlink"),
            search: (...args) => unsupported("search"),
            searchRead: (...args) => unsupported("searchRead"),
            searchCount: (...args) => unsupported("searchCount"),
            readGroup: (...args) => unsupported("readGroup"),
            webReadGroup: (...args) => unsupported("webReadGroup"),
            webRead: (...args) => unsupported("webRead"),
            webSearchRead: (...args) => unsupported("webSearchRead"),
            webSave: (...args) => unsupported("webSave"),
            nameGet: (...args) => unsupported("nameGet"),
            nameSearch: (...args) => unsupported("nameSearch"),
            nameCreate: (...args) => unsupported("nameCreate"),
            onchange: (...args) => unsupported("onchange"),
            defaultGet: (...args) => unsupported("defaultGet"),
            fieldsGet: (...args) => unsupported("fieldsGet"),
            getViews: (...args) => unsupported("getViews"),

            withContext(additionalContext = {}) {
                const mergedContext = {
                    ...context(),
                    ...additionalContext,
                };
                return {
                    ...this,
                    context: mergedContext,
                };
            },

            transaction(callback) {
                return unsupported("transaction");
            },
        };
    },
};
