/** @odoo-module **/

import { Component, onWillStart, useState } from "@odoo/owl";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

export class OfflineDownloadSystray extends Component {
    static components = { Dropdown, DropdownItem };
    static template = "offline_orm.OfflineDownloadSystray";

    setup() {
        this.appDownload = useService("offline_app_download");
        this.notification = useService("notification");
        this.state = useState({ apps: [], loading: false, downloading: null, loaded: false });
        onWillStart(() => this._loadApps());
    }

    async _loadApps() {
        try {
            const apps = await this.appDownload.discoverApps();
            this.state.apps = await Promise.all(apps.map(async (app) => ({
                ...app,
                downloaded: await this.appDownload.isDownloaded(app.technical_name),
            })));
        } catch (error) {
            this.notification.add(error.message || "Impossible de charger les applications.", {
                type: "danger",
            });
        } finally {
            this.state.loaded = true;
        }
    }

    async download(app) {
        if (this.state.loading) return;
        this.state.loading = true;
        this.state.downloading = app.technical_name;
        try {
            await this.appDownload.downloadApp(app.technical_name);
            app.downloaded = true;
            this.notification.add(`${app.name} est disponible hors ligne.`, { type: "success" });
        } catch (error) {
            this.notification.add(error.message || `Échec du téléchargement de ${app.name}.`, {
                type: "danger",
            });
        } finally {
            this.state.loading = false;
            this.state.downloading = null;
        }
    }
}

registry.category("systray").add(
    "offline_orm.download",
    { Component: OfflineDownloadSystray },
    { sequence: 50 },
);
