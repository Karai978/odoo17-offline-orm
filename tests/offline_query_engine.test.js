import test from "node:test";
import assert from "node:assert/strict";
import { OfflineQueryEngine } from "../offline_orm/static/src/offline_query_engine.js";

function database(records, fields = {}) {
    return {
        async findRecords(model) {
            return records.filter((record) => record.model === model && !record.deleted);
        },
        async getRecord(model, id) {
            return records.find((record) => record.model === model && (record.server_id === id || record.local_id === id));
        },
        async getMetadata(kind, model) {
            return kind === "fields" ? fields[model] || {} : null;
        },
    };
}

const partnerFields = {
    res_partner: {
        id: { type: "integer" },
        name: { type: "char" },
    },
    sale_order: {
        id: { type: "integer" },
        name: { type: "char" },
        amount_total: { type: "float" },
        partner_id: { type: "many2one", relation: "res_partner" },
    },
};

const records = [
    { model: "res_partner", server_id: 7, local_uuid: "p7", values: { name: "Acme" } },
    { model: "res_partner", server_id: 8, local_uuid: "p8", values: { name: "Beta" } },
    { model: "sale_order", server_id: 1, local_uuid: "s1", values: { name: "S001", amount_total: 100, partner_id: 7 } },
    { model: "sale_order", server_id: 2, local_uuid: "s2", values: { name: "S002", amount_total: 250, partner_id: 8 } },
    { model: "sale_order", server_id: 3, local_uuid: "s3", values: { name: "S003", amount_total: 75, partner_id: 7 } },
];

test("search evaluates Odoo-style domains and ordering", async () => {
    const engine = new OfflineQueryEngine({ database: database(records, partnerFields) });
    assert.deepEqual(await engine.search("sale_order", [["amount_total", ">", 90]], { order: "amount_total desc" }), [2, 1]);
    assert.deepEqual(await engine.search("sale_order", ["|", ["partner_id", "=", 7], ["amount_total", ">", 200]]), [1, 2, 3]);
});

test("webRead resolves nested many2one specifications", async () => {
    const engine = new OfflineQueryEngine({ database: database(records, partnerFields) });
    const result = await engine.webRead("sale_order", [1], {
        name: {},
        partner_id: { fields: { id: {}, display_name: {} } },
    });
    assert.equal(result[0].id, 1);
    assert.equal(result[0].name, "S001");
    assert.equal(result[0].partner_id.id, 7);
    assert.equal(result[0].partner_id.display_name, "Acme");
});

test("webSearchRead returns Odoo-compatible length and records", async () => {
    const engine = new OfflineQueryEngine({ database: database(records, partnerFields) });
    const result = await engine.webSearchRead("sale_order", [], { name: {}, amount_total: {} }, { limit: 2, order: "amount_total desc" });
    assert.equal(result.length, 3);
    assert.deepEqual(result.records.map((record) => record.id), [2, 1]);
});

test("webReadGroup returns grouped records with domains and counts", async () => {
    const engine = new OfflineQueryEngine({ database: database(records, partnerFields) });
    const result = await engine.webReadGroup("sale_order", [], ["amount_total:sum"], ["partner_id"], {});
    assert.equal(result.length, 2);
    const acme = result.groups.find((group) => group.partner_id === 7);
    assert.equal(acme.__count, 2);
    assert.equal(acme["amount_total:sum"], 175);
    assert.deepEqual(acme.__domain, [["partner_id", "=", 7]]);
});
