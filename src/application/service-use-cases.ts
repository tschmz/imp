import { createServiceInstallPlan, renderServiceDefinition } from "../service/install-plan.js";
import { assertServiceInstallCanProceed, installService, resolveServiceDefinitionPath } from "../service/install-service.js";
import { restartService, startService, statusService, stopService } from "../service/manage-service.js";
import { mapServiceError } from "../service/service-error.js";
import { uninstallService } from "../service/uninstall-service.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { resolveServiceConfigPath } from "./runtime-target.js";

export interface ServiceUseCases {
  installService: (options: { configPath?: string; dryRun: boolean; force: boolean }) => Promise<void>;
  uninstallService: (options: { configPath?: string }) => Promise<void>;
  startService: (options: { configPath?: string }) => Promise<void>;
  stopService: (options: { configPath?: string }) => Promise<void>;
  restartService: (options: { configPath?: string }) => Promise<void>;
  statusService: (options: { configPath?: string }) => Promise<void>;
}

interface ServiceUseCaseDependencies {
  discoverConfigPath: typeof discoverConfigPath;
  resolveServiceConfigPath: typeof resolveServiceConfigPath;
  createServiceInstallPlan: typeof createServiceInstallPlan;
  renderServiceDefinition: typeof renderServiceDefinition;
  resolveServiceDefinitionPath: typeof resolveServiceDefinitionPath;
  assertServiceInstallCanProceed: typeof assertServiceInstallCanProceed;
  installService: typeof installService;
  uninstallService: typeof uninstallService;
  startService: typeof startService;
  stopService: typeof stopService;
  restartService: typeof restartService;
  statusService: typeof statusService;
  writeOutput: (line: string) => void;
}

export function createServiceUseCases(
  dependencies: Partial<ServiceUseCaseDependencies> = {},
): ServiceUseCases {
  const deps: ServiceUseCaseDependencies = {
    discoverConfigPath,
    resolveServiceConfigPath,
    createServiceInstallPlan,
    renderServiceDefinition,
    resolveServiceDefinitionPath,
    assertServiceInstallCanProceed,
    installService,
    uninstallService,
    startService,
    stopService,
    restartService,
    statusService,
    writeOutput: console.log,
    ...dependencies,
  };

  return {
    installService: async ({ configPath, dryRun, force }) => {
      await withServiceErrorMapping(async () => {
        const { configPath: resolvedConfigPath } = await deps.discoverConfigPath({
          cliConfigPath: configPath,
        });
        const plan = deps.createServiceInstallPlan({ configPath: resolvedConfigPath });

        if (dryRun) {
          deps.writeOutput(deps.renderServiceDefinition(plan));
          return;
        }

        const definitionPath = deps.resolveServiceDefinitionPath({
          platform: plan.platform,
          serviceName: plan.serviceName,
          serviceLabel: plan.serviceLabel,
        });

        await deps.assertServiceInstallCanProceed({
          definitionPath,
          force,
        });

        const result = await deps.installService({ configPath: resolvedConfigPath, force: true });
        deps.writeOutput(`Installed ${result.operation.platform} service at ${result.operation.definitionPath}`);
      });
    },
    uninstallService: async ({ configPath }) => {
      await withServiceErrorMapping(async () => {
        const resolvedConfigPath = deps.resolveServiceConfigPath({ cliConfigPath: configPath });
        const result = await deps.uninstallService({
          configPath: resolvedConfigPath,
        });
        deps.writeOutput(`Removed ${result.operation.platform} service at ${result.operation.definitionPath}`);
      });
    },
    startService: async ({ configPath }) => {
      await withServiceErrorMapping(async () => {
        const resolvedConfigPath = deps.resolveServiceConfigPath({ cliConfigPath: configPath });
        const result = await deps.startService({ configPath: resolvedConfigPath });
        deps.writeOutput(`Started ${result.platform} service ${result.serviceName}`);
      });
    },
    stopService: async ({ configPath }) => {
      await withServiceErrorMapping(async () => {
        const resolvedConfigPath = deps.resolveServiceConfigPath({ cliConfigPath: configPath });
        const result = await deps.stopService({ configPath: resolvedConfigPath });
        deps.writeOutput(`Stopped ${result.platform} service ${result.serviceName}`);
      });
    },
    restartService: async ({ configPath }) => {
      await withServiceErrorMapping(async () => {
        const resolvedConfigPath = deps.resolveServiceConfigPath({ cliConfigPath: configPath });
        const result = await deps.restartService({ configPath: resolvedConfigPath });
        deps.writeOutput(`Restarted ${result.platform} service ${result.serviceName}`);
      });
    },
    statusService: async ({ configPath }) => {
      await withServiceErrorMapping(async () => {
        const resolvedConfigPath = deps.resolveServiceConfigPath({ cliConfigPath: configPath });
        const result = await deps.statusService({ configPath: resolvedConfigPath });

        if (result.statusOutput && result.statusOutput.length > 0) {
          deps.writeOutput(result.statusOutput);
        }
      });
    },
  };
}

async function withServiceErrorMapping(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const mapped = mapServiceError(error);
    throw new Error(`[${mapped.code}] ${mapped.message}`);
  }
}
