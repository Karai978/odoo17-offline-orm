/** @odoo-module **/

import { registry } from "@web/core/registry";
import { offlineBootstrapService } from "./offline_bootstrap";

registry.category("services").add("offline_bootstrap", offlineBootstrapService);
