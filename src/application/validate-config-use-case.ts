import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";

export function createValidateConfigUseCase(): (options: { configPath?: string }) => Promise<void> {
  return async ({ configPath }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    await loadAppConfig(resolvedConfigPath);
    console.log(`Config valid: ${resolvedConfigPath}`);
  };
}
