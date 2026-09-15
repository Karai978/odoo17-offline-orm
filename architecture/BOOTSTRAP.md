# Odoo 17 Bootstrap

## Goal

The bootstrap phase creates the first local snapshot while the native Odoo WebClient is still connected:

```text
Odoo server
  -> user context
  -> menus
  -> window actions
  -> models
  -> fields
  -> views
  -> effective ACL checks
  -> business records
  -> relation closure
  -> IndexedDB
```

The bootstrap engine is `offline_orm/static/src/offline_bootstrap.js`. It is registered as the native Odoo service `offline_bootstrap` and depends on the already replaced native-compatible `orm` service and the native `user` service.

No menu renderer, action service, form model, list model or WebClient replacement is introduced.

## What is stored

| Logical data | IndexedDB metadata key/store |
|---|---|
| User context | `metadata:user_context:current` |
| Menus | `metadata:menus:all` |
| Window actions | `metadata:actions:window` |
| Model information | `metadata:models:<model>` |
| Field definitions | `metadata:fields:<model>` |
| Effective model ACL checks | `metadata:access:<model>` |
| View specifications/architectures | `metadata:views:<model>` |
| Canonical business records | `records` |
| Durable local/server identity | `id_mapping` (used by later sync work) |

The business records are written through `OfflineDatabase.putRecord()` and remain server records (`server_id`) with `sync_state: "synced"`.

## Generic model discovery

If `models` is supplied, those models are the bootstrap roots. Otherwise the engine discovers models from visible `ir.ui.menu` entries whose actions are `ir.actions.act_window` records.

For every root model it snapshots its relational field IDs. Related models can then be fetched up to `relationDepth`.

This is deliberately not a hardcoded Sales/Purchase/CRM list.

## Security boundary

`check_access_rights` is evaluated for `read`, `write`, `create` and `unlink` in the current Odoo user context. Business reads are also executed through the normal ORM, so record rules remain enforced by the server during bootstrap.

This is not yet a complete local record-rule engine. The local database must therefore be treated as a snapshot of data the user was allowed to receive, while the synchronization layer remains responsible for server-side validation and conflicts.

## First Sales test

The first controlled test should use an explicit model root instead of downloading every application:

```js
await env.services.offline_bootstrap.run({
    models: ["sale.order"],
    relationDepth: 1,
    pageSize: 100,
    maxRecordsPerModel: 500,
});
```

The result contains `counts`, per-model information and `errors` and is also stored as `metadata:bootstrap:last_run`.

For a later generic full installation snapshot, omit `models` and apply a controlled record limit/profile rather than attempting an unlimited download.

## Important limits of this milestone

The bootstrap does not yet implement:

- incremental `write_date` refresh;
- attachment/binary download strategy;
- translation catalog download;
- local evaluation of record-rule domains;
- server method/onchange/compute execution offline;
- sync conflict resolution;
- atomic multi-store bootstrap transactions;
- automatic startup download.

Those are subsequent layers. The current milestone establishes the canonical local snapshot required before disconnecting the native WebClient.
