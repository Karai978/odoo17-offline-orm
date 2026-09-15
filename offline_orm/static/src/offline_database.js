/**
 * Offline Database boundary.
 *
 * This module defines the canonical local-data contract. The concrete
 * IndexedDB implementation will be introduced without exposing storage
 * details to the ORM facade.
 */

export const RECORD_SYNC_STATE = Object.freeze({
    SYNCED: "synced",
    PENDING_CREATE: "pending_create",
    PENDING_WRITE: "pending_write",
    PENDING_DELETE: "pending_delete",
    CONFLICT: "conflict",
    ERROR: "error",
});

export class OfflineDatabase {
    constructor({ name = "odoo17_offline_orm", version = 1 } = {}) {
        this.name = name;
        this.version = version;
        this.ready = false;
    }

    async open() {
        // Storage implementation is deliberately isolated behind this API.
        this.ready = true;
        return this;
    }

    async close() {
        this.ready = false;
    }

    async transaction(_stores, callback) {
        if (!this.ready) {
            await this.open();
        }
        return callback(this);
    }

    async getRecord(_model, _identity) {
        throw new Error("OfflineDatabase.getRecord is not implemented yet");
    }

    async putRecord(_record) {
        throw new Error("OfflineDatabase.putRecord is not implemented yet");
    }

    async deleteRecord(_model, _identity) {
        throw new Error("OfflineDatabase.deleteRecord is not implemented yet");
    }

    async findRecords(_model) {
        throw new Error("OfflineDatabase.findRecords is not implemented yet");
    }

    async getMetadata(_kind, _key) {
        throw new Error("OfflineDatabase.getMetadata is not implemented yet");
    }

    async putMetadata(_kind, _key, _value) {
        throw new Error("OfflineDatabase.putMetadata is not implemented yet");
    }

    async enqueue(_operation) {
        throw new Error("OfflineDatabase.enqueue is not implemented yet");
    }

    async mapIdentity(_model, _localUUID, _serverId) {
        throw new Error("OfflineDatabase.mapIdentity is not implemented yet");
    }
}
