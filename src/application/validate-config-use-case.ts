import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import { validateAppConfigSecretReferences } from "../config/validate-secret-references.js";

interface ValidateConfigUseCaseDependencies {
  writeOutput: (line: string) => void;
}

export function createValidateConfigUseCase(
  dependencies: Partial<ValidateConfigUseCaseDependencies> = {},
): (options: { configPath?: string }) => Promise<void> {
  const deps: ValidateConfigUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    const appConfig = await loadAppConfig(resolvedConfigPath);
    await validateAppConfigSecretReferences(appConfig, resolvedConfigPath);
    deps.writeOutput(`Config valid: ${resolvedConfigPath}`);
  };
}
