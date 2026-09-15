# Local Data Model

The local database is generic. It does not create one physical store per Odoo model.

## Canonical record

```js
{
    model: "sale.order",
    server_id: 42,
    local_uuid: "uuid",
    values: {
        name: "S00042",
        partner_id: 7,
        amount_total: 150000,
    },
    sync_state: "synced",
    deleted: false,
    write_date: "2026-01-01 10:00:00",
    updated_at: "2026-01-01T10:00:00.000Z",
    version: 1,
}
```

For an offline-created record, `server_id` is initially null and `sync_state` is pending.

## Identity

A record can be addressed by:

```text
(model, server_id)
```

or, for a locally-created record:

```text
(model, local_uuid)
```

The ID mapping is durable and survives application restarts.

## Logical stores

```text
metadata
records
relations
sync_queue
id_mapping
transactions
logs
```

Physical IndexedDB organization may change during implementation as long as the logical contract remains stable.

## Deletion

Offline deletion is represented as a tombstone (`deleted = true`) until synchronization is confirmed. Normal queries exclude tombstoned records.

## One2many

Child records remain independent records. A one2many value is reconstructed by querying the child model through its inverse relation rather than duplicating complete child objects in the parent record.

## Atomic writes

A local write that must be synchronized consists of:

1. canonical record mutation;
2. sync queue mutation;
3. required ID/relation changes.

These operations must commit or roll back together.
