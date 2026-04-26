import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import { createConfigGetView } from "./config-get-view.js";
import { getValueAtKeyPath } from "./config-key-path.js";

interface GetConfigValueUseCaseDependencies {
  writeOutput: (line: string) => void;
}

export function createGetConfigValueUseCase(
  dependencies: Partial<GetConfigValueUseCaseDependencies> = {},
): (options: {
  configPath?: string;
  keyPath: string;
}) => Promise<void> {
  const deps: GetConfigValueUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath, keyPath }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    const config = await loadAppConfig(resolvedConfigPath);
    const value = getValueAtKeyPath(createConfigGetView(config), keyPath);

    if (value === undefined) {
      throw new Error(`Config key not found: ${keyPath}`);
    }

    deps.writeOutput(formatConfigValue(value));
  };
}

function formatConfigValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return String(value);
    default:
      return JSON.stringify(value, null, 2);
  }
}
