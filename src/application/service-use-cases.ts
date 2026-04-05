import { createServiceInstallPlan, renderServiceDefinition } from "../service/install-plan.js";
import { assertServiceInstallCanProceed, installService, resolveServiceDefinitionPath } from "../service/install-service.js";
import { restartService, startService, statusService, stopService } from "../service/manage-service.js";
import { uninstallService } from "../service/uninstall-service.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { resolveServiceConfigPath, resolveServiceTarget } from "./runtime-target.js";

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
  resolveServiceTarget: typeof resolveServiceTarget;
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
    resolveServiceTarget,
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
      deps.writeOutput(`Installed ${result.platform} service at ${result.definitionPath}`);
    },
    uninstallService: async ({ configPath }) => {
      const resolvedConfigPath = deps.resolveServiceConfigPath({ cliConfigPath: configPath });
      const plan = deps.createServiceInstallPlan({ configPath: resolvedConfigPath });
      const definitionPath = deps.resolveServiceDefinitionPath({
        platform: plan.platform,
        serviceName: plan.serviceName,
        serviceLabel: plan.serviceLabel,
      });
      const result = await deps.uninstallService({
        platform: plan.platform,
        definitionPath,
        serviceName: plan.serviceName,
        serviceLabel: plan.serviceLabel,
      });
      deps.writeOutput(`Removed ${result.platform} service at ${result.definitionPath}`);
    },
    startService: async ({ configPath }) => {
      const serviceTarget = deps.resolveServiceTarget({ cliConfigPath: configPath });
      await deps.startService(serviceTarget);
      deps.writeOutput(`Started ${serviceTarget.platform} service ${serviceTarget.serviceName}`);
    },
    stopService: async ({ configPath }) => {
      const serviceTarget = deps.resolveServiceTarget({ cliConfigPath: configPath });
      await deps.stopService(serviceTarget);
      deps.writeOutput(`Stopped ${serviceTarget.platform} service ${serviceTarget.serviceName}`);
    },
    restartService: async ({ configPath }) => {
      const serviceTarget = deps.resolveServiceTarget({ cliConfigPath: configPath });
      await deps.restartService(serviceTarget);
      deps.writeOutput(`Restarted ${serviceTarget.platform} service ${serviceTarget.serviceName}`);
    },
    statusService: async ({ configPath }) => {
      const serviceTarget = deps.resolveServiceTarget({ cliConfigPath: configPath });
      const output = await deps.statusService(serviceTarget);

      if (output.length > 0) {
        deps.writeOutput(output);
      }
    },
  };
}
