import type { ServicePlatform } from "../install-plan.js";
import { linuxSystemdUserAdapter } from "./linux-systemd-user-adapter.js";
import { macosLaunchdAdapter } from "./macos-launchd-adapter.js";
import type { ServicePlatformAdapter } from "./service-platform-adapter.js";
import { windowsWinSwAdapter } from "./windows-winsw-adapter.js";

const adaptersByPlatform: Record<ServicePlatform, ServicePlatformAdapter> = {
  "linux-systemd-user": linuxSystemdUserAdapter,
  "macos-launchd-agent": macosLaunchdAdapter,
  "windows-winsw": windowsWinSwAdapter,
};

export function getServicePlatformAdapter(platform: ServicePlatform): ServicePlatformAdapter {
  return adaptersByPlatform[platform];
}
