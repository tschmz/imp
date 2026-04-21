import { discoverConfigPath } from "../config/discover-config-path.js";
import { syncManagedSkills } from "../config/init-app-config.js";

interface SyncManagedSkillsUseCaseDependencies {
  writeOutput: (line: string) => void;
}

export function createSyncManagedSkillsUseCase(
  dependencies: Partial<SyncManagedSkillsUseCaseDependencies> = {},
): (options: { configPath?: string }) => Promise<void> {
  const deps: SyncManagedSkillsUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    const updatedPaths = await syncManagedSkills({
      configPath: resolvedConfigPath,
    });

    for (const path of updatedPaths) {
      deps.writeOutput(`Updated managed skill at ${path}`);
    }
  };
}
