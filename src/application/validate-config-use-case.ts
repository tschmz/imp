import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import { validateAppConfigSecretReferences } from "../config/validate-secret-references.js";

export function createValidateConfigUseCase(): (options: { configPath?: string }) => Promise<void> {
  return async ({ configPath }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    const appConfig = await loadAppConfig(resolvedConfigPath);
    await validateAppConfigSecretReferences(appConfig, resolvedConfigPath);
    console.log(`Config valid: ${resolvedConfigPath}`);
  };
}
