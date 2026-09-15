/** @odoo-module **/

/**
 * Canonical IndexedDB storage for the Odoo 17 Offline ORM.
 *
 * Application-agnostic: no Sales, Purchase, CRM, or other business rules
 * belong here. This is the persistence boundary for canonical records,
 * metadata, sync operations and durable identity mappings.
 */

export const RECORD_SYNC_STATE = Object.freeze({
    SYNCED: "synced",
    PENDING_CREATE: "pending_create",
    PENDING_WRITE: "pending_write",
    PENDING_DELETE: "pending_delete",
    CONFLICT: "conflict",
    ERROR: "error",
});

const DB_SCHEMA_VERSION = 1;

function makeUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
}

export class OfflineDatabase {
    constructor({ name = "odoo17_offline_orm", version = DB_SCHEMA_VERSION } = {}) {
        this.name = name;
        this.version = version;
        this.ready = false;
        this.db = null;
        this._nextLocalId = -1;
    }

    async open() {
        if (this.ready && this.db) return this;
        if (typeof indexedDB === "undefined") {
            throw new Error("IndexedDB is not available in this environment");
        }

        this.db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(this.name, this.version);
            request.onupgradeneeded = () => {
                const database = request.result;

                if (!database.objectStoreNames.contains("records")) {
                    const store = database.createObjectStore("records", { keyPath: "key" });
                    store.createIndex("model", "model", { unique: false });
                    store.createIndex("sync_state", "sync_state", { unique: false });
                    store.createIndex("model_server_id", ["model", "server_id"], { unique: false });
                    store.createIndex("model_local_uuid", ["model", "local_uuid"], { unique: false });
                    store.createIndex("model_local_id", ["model", "local_id"], { unique: false });
                }
                if (!database.objectStoreNames.contains("metadata")) {
                    database.createObjectStore("metadata", { keyPath: "key" });
                }
                if (!database.objectStoreNames.contains("sync_queue")) {
                    const store = database.createObjectStore("sync_queue", { keyPath: "local_uuid" });
                    store.createIndex("status", "status", { unique: false });
                    store.createIndex("created_at", "created_at", { unique: false });
                }
                if (!database.objectStoreNames.contains("id_mapping")) {
                    const store = database.createObjectStore("id_mapping", { keyPath: "key" });
                    store.createIndex("model_local_uuid", ["model", "local_uuid"], { unique: true });
                    store.createIndex("model_server_id", ["model", "server_id"], { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        this.db.onversionchange = () => this.close();
        this.ready = true;
        return this;
    }

    async close() {
        if (this.db) this.db.close();
        this.db = null;
        this.ready = false;
    }

    async transaction(stores, callback) {
        await this.open();
        const names = Array.isArray(stores) ? stores : [stores];
        const transaction = this.db.transaction(names, "readwrite");
        const result = await callback(transaction);
        await transactionToPromise(transaction);
        return result;
    }

    _identity(record) {
        return record.server_id ?? record.local_id ?? record.local_uuid;
    }

    _recordKey(model, record) {
        return `${model}:${String(this._identity(record))}`;
    }

    allocateLocalId() {
        return this._nextLocalId--;
    }

    async getRecord(model, identity) {
        await this.open();
        const store = this.db.transaction("records", "readonly").objectStore("records");
        const direct = await requestToPromise(store.get(`${model}:${String(identity)}`));
        if (direct) return direct;
        const records = await this.findRecords(model, { includeDeleted: true });
        return records.find((record) =>
            record.server_id === identity || record.local_id === identity || record.local_uuid === identity
        ) || null;
    }

    async putRecord(record) {
        await this.open();
        const normalized = {
            local_uuid: record.local_uuid || makeUUID(),
            local_id: record.local_id ?? null,
            server_id: record.server_id ?? null,
            model: record.model,
            values: { ...(record.values || {}) },
            sync_state: record.sync_state || RECORD_SYNC_STATE.SYNCED,
            deleted: Boolean(record.deleted),
            write_date: record.write_date ?? null,
            updated_at: record.updated_at || new Date().toISOString(),
            version: record.version || 1,
        };
        normalized.key = this._recordKey(normalized.model, normalized);
        const transaction = this.db.transaction("records", "readwrite");
        transaction.objectStore("records").put(normalized);
        await transactionToPromise(transaction);
        return normalized;
    }

    async deleteRecord(model, identity) {
        const record = await this.getRecord(model, identity);
        if (!record) return false;
        record.deleted = true;
        record.sync_state = RECORD_SYNC_STATE.PENDING_DELETE;
        record.updated_at = new Date().toISOString();
        await this.putRecord(record);
        return true;
    }

    async findRecords(model, { includeDeleted = false } = {}) {
        await this.open();
        const transaction = this.db.transaction("records", "readonly");
        const request = transaction.objectStore("records").index("model").getAll(model);
        const records = await requestToPromise(request);
        return includeDeleted ? records : records.filter((record) => !record.deleted);
    }

    async getMetadata(kind, key) {
        await this.open();
        const store = this.db.transaction("metadata", "readonly").objectStore("metadata");
        const entry = await requestToPromise(store.get(`${kind}:${key}`));
        return entry?.value ?? null;
    }

    async putMetadata(kind, key, value) {
        await this.open();
        const transaction = this.db.transaction("metadata", "readwrite");
        transaction.objectStore("metadata").put({ key: `${kind}:${key}`, kind, value });
        await transactionToPromise(transaction);
        return value;
    }

    async enqueue(operation) {
        await this.open();
        const entry = {
            local_uuid: operation.local_uuid || makeUUID(),
            model: operation.model,
            operation: operation.operation,
            payload: operation.payload || {},
            status: operation.status || "pending",
            created_at: operation.created_at || new Date().toISOString(),
            reference_write_date: operation.reference_write_date ?? null,
            reference_values: operation.reference_values ?? null,
            retry_count: operation.retry_count || 0,
            error_message: operation.error_message ?? null,
        };
        const transaction = this.db.transaction("sync_queue", "readwrite");
        transaction.objectStore("sync_queue").put(entry);
        await transactionToPromise(transaction);
        return entry;
    }

    async mapIdentity(model, localUUID, serverId) {
        await this.open();
        const entry = {
            key: `${model}:${localUUID}`,
            model,
            local_uuid: localUUID,
            server_id: serverId,
            mapped_at: new Date().toISOString(),
        };
        const transaction = this.db.transaction("id_mapping", "readwrite");
        transaction.objectStore("id_mapping").put(entry);
        await transactionToPromise(transaction);
        return entry;
    }

    async getIdentityMapping(model, localUUID) {
        await this.open();
        const store = this.db.transaction("id_mapping", "readonly").objectStore("id_mapping");
        return requestToPromise(store.get(`${model}:${localUUID}`));
    }
}
