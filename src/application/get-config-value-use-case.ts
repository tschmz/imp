import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import { getValueAtKeyPath } from "./config-key-path.js";

export function createGetConfigValueUseCase(): (options: {
  configPath?: string;
  keyPath: string;
}) => Promise<void> {
  return async ({ configPath, keyPath }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    const config = await loadAppConfig(resolvedConfigPath);
    const value = getValueAtKeyPath(config, keyPath);

    if (value === undefined) {
      throw new Error(`Config key not found: ${keyPath}`);
    }

    console.log(formatConfigValue(value));
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
