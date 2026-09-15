# Odoo 17 ORM Contract

The facade targets the public behavior used by the native Odoo 17 WebClient.

## Core methods

```text
call(model, method, args=[], kwargs={})
create(model, values, options={})
read(model, ids, fields, options={})
write(model, ids, values, options={})
unlink(model, ids, options={})
search(model, domain, options={})
searchRead(model, domain, fields, options={})
searchCount(model, domain, options={})
readGroup(model, domain, fields, groupby, options={})
webReadGroup(model, domain, fields, groupby, options={})
webRead(model, ids, specification, context={})
webSearchRead(model, domain, specification, context={})
webSave(model, id, values, specification, context={})
nameGet(model, ids, context={})
nameSearch(model, name, domain=[], operator="ilike", limit=100, context={})
nameCreate(model, name, context={})
onchange(model, ids, values, fieldName, specification, context={})
defaultGet(model, fields, context={})
fieldsGet(model, attributes, context={})
getViews(model, views, options={})
withContext(context)
transaction(callback)
```

The exact native Odoo 17 implementation and signatures remain the reference contract. This file describes the intended compatibility surface; implementation must be validated against the Odoo 17 source rather than approximated from memory.

## Error rules

### Connection loss

A native `ConnectionLostError` is a transport failure. In `AUTO` mode it can trigger a local fallback for operations that have a local implementation.

### RPC/application errors

`RPCError` must be propagated. It must not silently trigger local fallback because the server was reached and rejected or failed the requested operation.

### Unsupported offline operation

An operation with no local implementation must produce an explicit unsupported-offline error. It must never fabricate a successful result.

## Context

The service consumes the native Odoo `user.context`. It does not introduce a parallel user/session service.
