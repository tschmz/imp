import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { isMissingFileError } from "../files/node-error.js";
import { createServiceInstallPlan } from "./install-plan.js";
import type { ServiceInstaller } from "./install-service.js";
import { resolveServiceDefinitionPath } from "./install-service.js";
import { getServicePlatformAdapter } from "./platforms/get-service-platform-adapter.js";
import type { ServiceOperationResult } from "./service-operation-result.js";
import {
  createSystemServiceInstaller,
} from "./service-installer.js";
import { ServiceOperationError } from "./service-error.js";

export interface ServiceUninstallResult {
  operation: ServiceOperationResult;
}

export async function uninstallService(options: {
  configPath: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<ServiceUninstallResult> {
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
  const operation = await getServicePlatformAdapter(plan.platform).uninstall({
    installer,
    definitionPath,
    serviceName: plan.serviceName,
    serviceLabel: plan.serviceLabel,
    uid: options.uid,
  });

  await rm(definitionPath, { force: true });
  return {
    operation,
  };
}

export async function assertServiceDefinitionExists(definitionPath: string): Promise<string> {
  const resolvedPath = resolve(definitionPath);

  try {
    await access(resolvedPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new ServiceOperationError("not_installed", `Service definition not found: ${resolvedPath}`);
    }
    throw error;
  }

  return resolvedPath;
}
