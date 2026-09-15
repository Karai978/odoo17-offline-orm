import { registry } from "@web/core/registry";
import { offlineAppDownloadService } from "./offline_app_download";

registry.category("services").add("offline_app_download", offlineAppDownloadService);
