import { resolve } from "node:path";
import type { ServiceInstallPlan, ServicePlatform } from "../install-plan.js";
import type { ServiceInstaller } from "../service-installer.js";

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
  }): Promise<void>;
  uninstall(context: ServiceRuntimeContext): Promise<void>;
  start(context: ServiceRuntimeContext): Promise<void>;
  stop(context: ServiceRuntimeContext): Promise<void>;
  restart(context: ServiceRuntimeContext): Promise<void>;
  status(context: ServiceRuntimeContext): Promise<string>;
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
