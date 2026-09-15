# Architecture — First Offline ORM Service

## 1. Principle

The project does not create an alternative Odoo frontend. The native Odoo 17 WebClient remains the caller and continues to use the standard ORM contract.

```text
WebClient -> ORM -> Router -> RPC or Local Engine
```

The offline layer is therefore a local data/ORM backend compatible with the Odoo 17 frontend contract.

## 2. Components

### `offline_orm_service.js`

Public compatibility facade registered as the Odoo service named `orm`.

Responsibilities:
- preserve native ORM method signatures;
- use the native `user` context;
- use the native `rpc` service for online calls;
- delegate routing to `connection_router.js`;
- expose the local engine without leaking IndexedDB details to callers.

It must not depend on the native `orm` service because it replaces that service and doing so would create a circular dependency.

### `connection_router.js`

Determines whether an operation is executed through RPC or locally.

Modes:
- `AUTO` — production mode;
- `ONLINE` — force RPC;
- `OFFLINE` — force local execution.

`navigator.onLine` is advisory only. A native `ConnectionLostError` is treated as a transport failure and can switch AUTO mode to offline. `RPCError` is not an offline signal because it means the server answered with an application/server error.

### `offline_database.js`

Owns the local persistence boundary. The logical data model is generic and does not contain business-specific stores such as `sale_orders`.

Core logical categories:
- records;
- metadata;
- relations;
- sync queue;
- ID mapping;
- transactions;
- logs.

Canonical records carry a model name, durable local UUID, optional server ID, values, synchronization state and deletion state.

### `offline_query_engine.js`

Implements local ORM-style queries over the canonical database.

Initial responsibilities:
- domain evaluation;
- ordering;
- offset/limit;
- search;
- count;
- read/projection;
- searchRead;
- basic relation resolution;
- webRead/webSearchRead compatible shaping.

The query engine is generic and consumes model/field metadata instead of hardcoding Sales or another application.

## 3. Public ORM contract

### Read

```text
search
searchRead
searchCount
read
webRead
webSearchRead
```

### Write

```text
create
write
unlink
webSave
```

### Relations

```text
nameGet
nameSearch
nameCreate
```

### Metadata/context

```text
fieldsGet
getViews
withContext
transaction
```

### Aggregation/business methods

```text
readGroup
webReadGroup
onchange
defaultGet
call
```

These are part of the target facade, but are introduced incrementally. Arbitrary Python `call_kw` execution is never assumed to be reproducible offline.

## 4. Online path

```text
ORM facade
  -> Connection Router
  -> native rpc service
  -> /web/dataset/call_kw/<model>/<method>
  -> Odoo Python ORM
  -> PostgreSQL
```

## 5. Offline read path

```text
ORM facade
  -> Connection Router
  -> Query Engine
  -> Local Database
  -> IndexedDB
```

## 6. Offline write path

```text
ORM create/write/unlink/webSave
  -> local transaction
  -> canonical record mutation
  -> sync queue operation
  -> commit
```

Record mutation and creation/update of its sync operation must be atomic from the application's point of view.

## 7. Identity

Every locally-created record receives a durable `local_uuid` before synchronization.

After synchronization, the mapping is retained:

```text
(model, local_uuid) -> server_id
```

This allows relations created offline to be resolved after the server assigns real IDs.

## 8. Relations

Canonical values store references rather than duplicated record objects:

- many2one: referenced record ID/identity;
- many2many: referenced IDs/identities;
- one2many: independent child records reconstructed through the inverse relation.

A relation layer converts canonical identities to the structures expected by Odoo WebClient methods such as `webRead`.

## 9. Service startup

The replacement service must be registered in the native Odoo service registry under `orm` before native service startup begins.

Dependencies:

```text
rpc
user
```

No dependency on `orm` itself.

The addon integration will be handled only after the standalone service has been validated.
