import type { ServicePlatform } from "./install-plan.js";
import { getServicePlatformAdapter } from "./platforms/get-service-platform-adapter.js";
import {
  createSystemServiceInstaller,
  type ServiceInstaller,
} from "./service-installer.js";
import { assertServiceDefinitionExists } from "./uninstall-service.js";

export async function startService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<void> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();

  await getServicePlatformAdapter(options.platform).start({
    installer,
    definitionPath,
    serviceName: options.serviceName,
    serviceLabel: options.serviceLabel,
    uid: options.uid,
  });
}

export async function stopService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<void> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();

  await getServicePlatformAdapter(options.platform).stop({
    installer,
    definitionPath,
    serviceName: options.serviceName,
    serviceLabel: options.serviceLabel,
    uid: options.uid,
  });
}

export async function restartService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<void> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();

  await getServicePlatformAdapter(options.platform).restart({
    installer,
    definitionPath,
    serviceName: options.serviceName,
    serviceLabel: options.serviceLabel,
    uid: options.uid,
  });
}

export async function statusService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<string> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();

  return getServicePlatformAdapter(options.platform).status({
    installer,
    definitionPath,
    serviceName: options.serviceName,
    serviceLabel: options.serviceLabel,
    uid: options.uid,
  });
}
