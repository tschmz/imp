import { createServiceInstallPlan, type ServicePlatformInput } from "./install-plan.js";
import { getServicePlatformAdapter } from "./platforms/get-service-platform-adapter.js";
import type { ServiceOperationResult } from "./service-operation-result.js";
import {
  createSystemServiceInstaller,
  type ServiceInstaller,
} from "./service-installer.js";
import { resolveServiceDefinitionPath } from "./install-service.js";
import { assertServiceDefinitionExists } from "./uninstall-service.js";

export type ManageServiceOptions = {
  configPath: string;
  platform?: ServicePlatformInput;
  homeDir?: string;
  uid?: number;
  installer?: ServiceInstaller;
};

function runServiceOperation(
  operation: "status" | "start" | "stop" | "restart",
  options: ManageServiceOptions,
): Promise<ServiceOperationResult>;
async function runServiceOperation(
  operation: "status" | "start" | "stop" | "restart",
  options: ManageServiceOptions,
): Promise<ServiceOperationResult> {
  const plan = createServiceInstallPlan({ configPath: options.configPath, platform: options.platform });
  const definitionPath = await assertServiceDefinitionExists(
    resolveServiceDefinitionPath({
      platform: plan.platform,
      homeDir: options.homeDir,
      serviceName: plan.serviceName,
      serviceLabel: plan.serviceLabel,
    }),
  );
  const installer = options.installer ?? createSystemServiceInstaller();
  const adapter = getServicePlatformAdapter(plan.platform);

  return adapter[operation]({
    installer,
    definitionPath,
    serviceName: plan.serviceName,
    serviceLabel: plan.serviceLabel,
    uid: options.uid,
  });
}

export async function startService(options: ManageServiceOptions): Promise<ServiceOperationResult> {
  return runServiceOperation("start", options);
}

export async function stopService(options: ManageServiceOptions): Promise<ServiceOperationResult> {
  return runServiceOperation("stop", options);
}

export async function restartService(options: ManageServiceOptions): Promise<ServiceOperationResult> {
  return runServiceOperation("restart", options);
}

export async function statusService(options: ManageServiceOptions): Promise<ServiceOperationResult> {
  return runServiceOperation("status", options);
}
