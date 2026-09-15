/** @odoo-module **/

import { registry } from "@web/core/registry";
import { OfflineDownloadSystray } from "./offline_download_systray";

registry.category("systray").add(
    "offline_orm.download",
    { Component: OfflineDownloadSystray },
    { sequence: 50 },
);
