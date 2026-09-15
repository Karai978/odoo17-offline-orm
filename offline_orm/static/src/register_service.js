/**
 * Odoo 17 integration adapter.
 *
 * This is the only file responsible for registering the offline ORM in the
 * native service registry. The native WebClient, views and models are not
 * replaced.
 */

import { registry } from "@web/core/registry";
import { offlineOrmService } from "./offline_orm_service";

registry.category("services").add("orm", offlineOrmService, { force: true });
