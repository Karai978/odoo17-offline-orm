# Odoo 17 Native WebClient Bridge

## Principle

There is no offline SearchModel, RelationalModel, ListModel, FormModel, KanbanModel, ActionService, or WebClient in this project.

The bridge is the Odoo 17 `orm` service contract itself:

```text
Native SearchModel / RelationalModel
              |
              v
       env.services.orm
              |
       OfflineORM facade
          /         \
     online         offline
       |               |
 native RPC       OfflineQueryEngine
                       |
                  IndexedDB
```

`register_service.js` deliberately registers the offline-compatible ORM under the native service key `orm` with `force: true`. This means native Odoo consumers continue to call the same methods and do not need to know the connection mode.

## Read contracts

The offline facade preserves the contracts consumed by Odoo 17 relational views:

- `search`
- `searchRead`
- `searchCount`
- `read`
- `webRead`
- `webSearchRead`
- `readGroup`
- `webReadGroup`

The most important UI paths are:

```text
List
  -> RelationalModel
  -> orm.webSearchRead()
  -> {length, records}

Form
  -> RelationalModel / Record
  -> orm.webRead()
  -> [{id, field values...}]

Grouped List / Kanban grouping
  -> RelationalModel
  -> orm.webReadGroup()
  -> Odoo-compatible group result
```

## Offline fallback

`ConnectionRouter` uses AUTO mode by default.

```text
orm operation
   |
   +-- RPC succeeds -----------------> server result
   |
   +-- ConnectionLostError ----------> local query
   |
   +-- RPCError ---------------------> propagate server error
   |
   +-- ConnectionAbortedError -------> propagate abort
```

A server-side validation/access/business error must never silently become an offline result.

## Canonical local data

`OfflineQueryEngine` reads only canonical records from `OfflineDatabase`. It does not read list caches as a source of truth.

Relations are resolved from field metadata and canonical related records. The native UI therefore receives relation values rather than a second custom UI representation.

## Bootstrap path

```text
Connected Odoo
    |
    v
offline_bootstrap
    |
    +--> user context
    +--> menus
    +--> window actions
    +--> fields metadata
    +--> views
    +--> access rights
    +--> business records
    +--> related records
    |
    v
OfflineDatabase
    |
    v
Disconnect
    |
    v
Native WebClient -> native ORM key -> OfflineQueryEngine -> IndexedDB
```

## Important boundary

This bridge makes read-side native List/Form/Kanban flows possible offline. It does not claim to reproduce arbitrary Python execution.

Still server-authoritative for now:

- arbitrary `call()` methods
- Python `onchange`
- `default_get` when no local implementation exists
- computed fields whose values were not snapshotted
- Python constraints
- server workflows such as `action_confirm`
- record-rule evaluation at the moment of an offline mutation

Those require explicit offline capabilities and are separate from the WebClient bridge.
