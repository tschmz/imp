import { loadAppConfig } from "../config/load-app-config.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { restartService } from "../service/manage-service.js";
import { resolveServiceTarget } from "./runtime-target.js";

interface ReloadConfigUseCaseDependencies {
  discoverConfigPath: typeof discoverConfigPath;
  loadAppConfig: typeof loadAppConfig;
  resolveServiceTarget: typeof resolveServiceTarget;
  restartService: typeof restartService;
  writeOutput: (line: string) => void;
}

export function createReloadConfigUseCase(
  dependencies: Partial<ReloadConfigUseCaseDependencies> = {},
): (options: { configPath?: string }) => Promise<void> {
  const deps: ReloadConfigUseCaseDependencies = {
    discoverConfigPath,
    loadAppConfig,
    resolveServiceTarget,
    restartService,
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath }) => {
    const { configPath: resolvedConfigPath } = await deps.discoverConfigPath({
      cliConfigPath: configPath,
    });

    await deps.loadAppConfig(resolvedConfigPath);

    const serviceTarget = deps.resolveServiceTarget({
      cliConfigPath: resolvedConfigPath,
    });

    await deps.restartService(serviceTarget);
    deps.writeOutput(
      `Validated ${resolvedConfigPath}; reloaded it by restarting ${serviceTarget.platform} service ${serviceTarget.serviceName}.`,
    );
  };
}
