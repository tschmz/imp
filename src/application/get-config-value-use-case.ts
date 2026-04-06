import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";

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

function getValueAtKeyPath(root: unknown, keyPath: string): unknown {
  let current: unknown = root;

  for (const segment of keyPath.split(".")) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      current = getArrayValue(current, segment);
      continue;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function getArrayValue(items: unknown[], segment: string): unknown {
  const numericIndex = Number(segment);
  if (Number.isInteger(numericIndex) && String(numericIndex) === segment) {
    return items[numericIndex];
  }

  return items.find((item) => hasMatchingId(item, segment));
}

function hasMatchingId(value: unknown, expectedId: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id === expectedId
  );
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
