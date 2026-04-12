import { discoverConfigPath, getDefaultUserConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import { resolveRuntimeConfig } from "../config/resolve-runtime-config.js";
import type { DaemonConfig } from "../daemon/types.js";
import type { Logger } from "../logging/types.js";
import { createServiceInstallPlan } from "../service/install-plan.js";
import { resolveServiceDefinitionPath } from "../service/install-service.js";
import { createTransport } from "../transports/registry.js";
import type { Transport, TransportFactory } from "../transports/types.js";

export const createRuntimeTransportFactory: TransportFactory<DaemonConfig["activeEndpoints"][number], Logger> =
  (endpointConfig, logger): Transport => createTransport(endpointConfig.type, endpointConfig, logger);

export async function resolveRuntimeTarget(options: { cliConfigPath?: string } = {}): Promise<{
  configPath: string;
  runtimeConfig: DaemonConfig;
  createTransport: TransportFactory<DaemonConfig["activeEndpoints"][number], Logger>;
}> {
  const { configPath } = await discoverConfigPath({
    cliConfigPath: options.cliConfigPath,
  });
  const appConfig = await loadAppConfig(configPath);

  return {
    configPath,
    runtimeConfig: await resolveRuntimeConfig(appConfig, configPath),
    createTransport: createRuntimeTransportFactory,
  };
}

export function resolveServiceConfigPath(options: {
  cliConfigPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  if (options.cliConfigPath) {
    return options.cliConfigPath;
  }

  const env = options.env ?? process.env;
  return env.IMP_CONFIG_PATH ?? getDefaultUserConfigPath(env);
}

export function resolveServiceTarget(options: {
  cliConfigPath?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const configPath = resolveServiceConfigPath(options);
  const plan = createServiceInstallPlan({ configPath });

  return {
    configPath,
    platform: plan.platform,
    definitionPath: resolveServiceDefinitionPath({
      platform: plan.platform,
      serviceName: plan.serviceName,
      serviceLabel: plan.serviceLabel,
    }),
    serviceName: plan.serviceName,
    serviceLabel: plan.serviceLabel,
  };
}
