# Odoo 17 Integration

The addon registers `offlineOrmService` under the native service key `orm` with `force: true`.

## Loading order

`offline_orm` depends on `web` and injects its registration file into `web.assets_backend`. Odoo's native `main.js` starts the WebClient after the backend asset bundle has been assembled, so the service registry replacement is present before `startServices()` creates the `orm` service.

## What is replaced

Only the service implementation behind `useService("orm")` is replaced.

The following remain native Odoo 17 components:

- WebClient
- Action service
- SearchModel
- RelationalModel
- List/Form/Kanban controllers
- RPC service
- User service
- view architecture and templates

## Online path

`useService("orm")` → Offline ORM facade → ConnectionRouter → native `rpc` → Odoo Python ORM.

## Offline path

`useService("orm")` → Offline ORM facade → ConnectionRouter → OfflineQueryEngine → IndexedDB.

A transport `ConnectionLostError` may trigger the local path in `AUTO` mode. An application-level `RPCError` must remain an application error and must not be interpreted as offline.

## Current local contract

Implemented locally:

- search
- searchRead
- searchCount
- read
- create
- write
- unlink
- webRead
- webSearchRead
- readGroup
- webReadGroup
- nameGet
- nameSearch
- basic webSave
- fieldsGet from cached metadata
- getViews from cached metadata

Not yet reproduced locally:

- arbitrary Python `call()` methods
- Python `onchange`
- Python `default_get`
- server-side computes and constraints
- complete ACL/rule enforcement
- advanced property fields and all Odoo grouping granularities

Those operations remain server-authoritative until an explicit offline implementation exists.
