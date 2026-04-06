import { resolve } from "node:path";
import type { ServiceInstallPlan, ServicePlatform } from "../install-plan.js";
import type { ServiceInstaller } from "../service-installer.js";
import type { ServiceOperationResult } from "../service-operation-result.js";

export interface ServiceRuntimeContext {
  installer: ServiceInstaller;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
}

export interface ServicePlatformAdapter {
  platform: ServicePlatform;
  renderDefinition(plan: ServiceInstallPlan): string;
  resolveDefinitionPath(options: {
    homeDir?: string;
    serviceName: string;
    serviceLabel: string;
  }): string;
  install(options: {
    installer: ServiceInstaller;
    definitionPath: string;
    plan: ServiceInstallPlan;
    uid?: number;
  }): Promise<ServiceOperationResult>;
  uninstall(context: ServiceRuntimeContext): Promise<ServiceOperationResult>;
  start(context: ServiceRuntimeContext): Promise<ServiceOperationResult>;
  stop(context: ServiceRuntimeContext): Promise<ServiceOperationResult>;
  restart(context: ServiceRuntimeContext): Promise<ServiceOperationResult>;
  status(context: ServiceRuntimeContext): Promise<ServiceOperationResult>;
  validate?(context: ServiceRuntimeContext): Promise<ServiceOperationResult>;
  diagnose?(context: ServiceRuntimeContext): Promise<ServiceOperationResult>;
}

export function normalizeHomeDirectory(homeDir: string | undefined, defaultHomeDir: string): string {
  return resolve(homeDir ?? defaultHomeDir);
}

export function joinCommandOutput(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter((chunk) => chunk.length > 0).join("\n");
}

export async function runIgnoringFailure(
  installer: ServiceInstaller,
  command: string,
  args: string[],
): Promise<void> {
  try {
    await installer.run(command, args);
  } catch {
    // Some service managers return an error when the requested state is already reached.
  }
}
