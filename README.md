# Odoo 17 Offline ORM

Experimental, native-compatible Offline ORM architecture for Odoo 17.

## Objective

Provide the native Odoo 17 WebClient with an `orm` service that can transparently route ORM operations to either the Odoo RPC server or a local IndexedDB engine.

The WebClient, views, SearchModel and RelationalModel are not reimplemented here.

## Architecture

```text
Native Odoo 17 WebClient
        |
        v
   service("orm")
        |
        v
 Connection Router
     /       \
 ONLINE     OFFLINE
   |            |
   v            v
  RPC      Query Engine
                |
                v
        Local Database
                |
                v
           IndexedDB
                |
                v
          Sync Queue
```

## First milestone

- Native-compatible ORM service facade
- Online/offline connection routing
- Generic local database abstraction
- Generic local query engine
- `search`, `searchRead`, `searchCount`, `read`
- `create`, `write`, `unlink`
- `webRead`, `webSearchRead`, `webSave`
- Durable local UUID and server ID mapping
- Transaction boundary between records and sync queue

Arbitrary Python methods are not emulated offline. `call()` will only support explicitly implemented offline methods.

## Repository rule

This repository is developed independently from the existing `odoo-offline` and `offline_sync` repositories. No files in those repositories are modified by this project.
