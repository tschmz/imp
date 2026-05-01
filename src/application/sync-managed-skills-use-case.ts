import { discoverConfigPath } from "../config/discover-config-path.js";
import { syncManagedSkills as syncManagedSkillsFromConfig } from "../config/init-app-config.js";

type SyncManagedSkills = (options: { configPath: string }) => Promise<string[]>;

interface SyncManagedSkillsUseCaseDependencies {
  writeOutput: (line: string) => void;
  syncManagedSkills: SyncManagedSkills;
}

export function createSyncManagedSkillsUseCase(
  dependencies: Partial<SyncManagedSkillsUseCaseDependencies> = {},
): (options: { configPath?: string }) => Promise<void> {
  const deps: SyncManagedSkillsUseCaseDependencies = {
    writeOutput: console.log,
    syncManagedSkills: syncManagedSkillsFromConfig,
    ...dependencies,
  };

  return async ({ configPath }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    const updatedPaths = await deps.syncManagedSkills({
      configPath: resolvedConfigPath,
    });

    for (const path of updatedPaths) {
      deps.writeOutput(`Updated managed skill at ${path}`);
    }
  };
}
