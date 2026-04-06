import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import {
  createServiceInstallPlan,
  type ServiceInstallPlan,
  type ServicePlatform,
  renderServiceDefinition,
} from "./install-plan.js";
import { renderLinuxServiceEnvironment } from "./linux-service-environment.js";
import { getServicePlatformAdapter } from "./platforms/get-service-platform-adapter.js";
import {
  createSystemServiceInstaller,
  type ServiceInstaller,
} from "./service-installer.js";

export type { ServiceInstaller };

export interface ServiceInstallResult {
  platform: ServicePlatform;
  definitionPath: string;
  environmentPath?: string;
  plan: ServiceInstallPlan;
}

export async function installService(options: {
  configPath: string;
  argv?: string[];
  execPath?: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  uid?: number;
  installer?: ServiceInstaller;
  force?: boolean;
  now?: Date;
  serviceEnvironment?: NodeJS.ProcessEnv;
}): Promise<ServiceInstallResult> {
  const plan = createServiceInstallPlan({
    configPath: options.configPath,
    argv: options.argv,
    execPath: options.execPath,
    platform: options.platform,
  });
  const platformAdapter = getServicePlatformAdapter(plan.platform);
  const definitionPath = platformAdapter.resolveDefinitionPath({
    homeDir: options.homeDir,
    serviceName: plan.serviceName,
    serviceLabel: plan.serviceLabel,
  });
  const definition = renderServiceDefinition(plan);
  let environmentPath: string | undefined;

  if (plan.platform === "linux-systemd-user") {
    environmentPath = plan.environmentPath;
    if (!environmentPath) {
      throw new Error("Linux service installation requires an environment file path.");
    }

    await writeManagedFile({
      path: environmentPath,
      resourceLabel: "Service environment file",
      content: await renderLinuxServiceEnvironment({
        path: environmentPath,
        env: options.serviceEnvironment,
        force: options.force,
      }),
      force: options.force,
      now: options.now,
    });
  }

  await writeManagedFile({
    path: definitionPath,
    resourceLabel: "Service definition",
    content: `${definition}\n`,
    force: options.force,
    now: options.now,
  });

  const installer = options.installer ?? createSystemServiceInstaller();
  await platformAdapter.install({
    installer,
    definitionPath,
    plan,
    uid: options.uid,
  });

  return {
    platform: plan.platform,
    definitionPath,
    environmentPath,
    plan,
  };
}

export async function assertServiceInstallCanProceed(options: {
  definitionPath: string;
  force?: boolean;
}): Promise<string> {
  return assertManagedFileCanBeWritten({
    path: options.definitionPath,
    resourceLabel: "Service definition",
    force: options.force,
  });
}

export function resolveServiceDefinitionPath(options: {
  platform: ServicePlatform;
  homeDir?: string;
  serviceName: string;
  serviceLabel: string;
}): string {
  return getServicePlatformAdapter(options.platform).resolveDefinitionPath({
    homeDir: options.homeDir,
    serviceName: options.serviceName,
    serviceLabel: options.serviceLabel,
  });
}
