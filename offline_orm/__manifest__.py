{
    "name": "Odoo 17 Offline ORM",
    "version": "17.0.1.0.0",
    "summary": "Native Odoo 17 ORM routing between RPC and local IndexedDB",
    "category": "Technical",
    "license": "LGPL-3",
    "depends": ["web"],
    "assets": {
        "web.assets_backend": [
            "offline_orm/static/src/offline_orm_service.js",
            "offline_orm/static/src/connection_router.js",
            "offline_orm/static/src/offline_database.js",
            "offline_orm/static/src/offline_query_engine.js",
            "offline_orm/static/src/register_service.js",
            "offline_orm/static/src/offline_bootstrap.js",
            "offline_orm/static/src/register_bootstrap.js",
        ],
    },
    "installable": True,
    "application": False,
}
