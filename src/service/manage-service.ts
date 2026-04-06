import type { ServicePlatform } from "./install-plan.js";
import { getServicePlatformAdapter } from "./platforms/get-service-platform-adapter.js";
import {
  createSystemServiceInstaller,
  type ServiceInstaller,
} from "./service-installer.js";
import { assertServiceDefinitionExists } from "./uninstall-service.js";

type ManageServiceOptions = {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
};

type NonStatusServiceOperation = "start" | "stop" | "restart";

type ServiceOperation = NonStatusServiceOperation | "status";

function runServiceOperation(
  operation: "status",
  options: ManageServiceOptions,
): Promise<string>;
function runServiceOperation(
  operation: NonStatusServiceOperation,
  options: ManageServiceOptions,
): Promise<void>;
async function runServiceOperation(
  operation: ServiceOperation,
  options: ManageServiceOptions,
): Promise<void | string> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();
  const adapter = getServicePlatformAdapter(options.platform);

  return adapter[operation]({
    installer,
    definitionPath,
    serviceName: options.serviceName,
    serviceLabel: options.serviceLabel,
    uid: options.uid,
  });
}

export async function startService(options: ManageServiceOptions): Promise<void> {
  await runServiceOperation("start", options);
}

export async function stopService(options: ManageServiceOptions): Promise<void> {
  await runServiceOperation("stop", options);
}

export async function restartService(options: ManageServiceOptions): Promise<void> {
  await runServiceOperation("restart", options);
}

export async function statusService(options: ManageServiceOptions): Promise<string> {
  return runServiceOperation("status", options);
}
