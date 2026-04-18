import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAppConfig } from "../config/load-app-config.js";
import { appConfigSchema } from "../config/schema.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { setValueAtKeyPath } from "./config-key-path.js";

interface SetConfigValueUseCaseDependencies {
  writeOutput: (line: string) => void;
}

export function createSetConfigValueUseCase(
  dependencies: Partial<SetConfigValueUseCaseDependencies> = {},
): (options: {
  configPath?: string;
  keyPath: string;
  value: string;
}) => Promise<void> {
  const deps: SetConfigValueUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath, keyPath, value }) => {
    const resolvedConfigPath = await resolveWritableConfigPath(configPath);
    const parsed = await loadAppConfig(resolvedConfigPath, {
      errorPrefix: `Invalid input config file ${resolvedConfigPath}`,
      validateSchema: false,
    });

    try {
      setValueAtKeyPath(parsed, keyPath, parseConfigValue(value));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid target key path: ${keyPath}\n${message}`);
    }

    assertUpdatedConfigIsValid(parsed, resolvedConfigPath);

    await writeFile(resolvedConfigPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    deps.writeOutput(`Updated config ${resolvedConfigPath}: ${keyPath}`);
  };
}

async function resolveWritableConfigPath(configPath?: string): Promise<string> {
  if (!configPath) {
    const discovery = await discoverConfigPath();
    return discovery.configPath;
  }

  const resolvedConfigPath = resolve(configPath);

  try {
    await access(resolvedConfigPath);
  } catch {
    throw new Error(`Config file not found: ${resolvedConfigPath}`);
  }

  return resolvedConfigPath;
}

function assertUpdatedConfigIsValid(config: unknown, configPath: string): void {
  const result = appConfigSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      formatSchemaError(`Config update violates schema: ${configPath}`, result.error.issues),
    );
  }
}

function formatSchemaError(
  prefix: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  const details = issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`).join("\n");
  return `${prefix}\n${details}`;
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "<root>";
  }

  let formatted = "";

  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
      continue;
    }

    if (typeof segment === "string") {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)) {
        formatted += formatted.length === 0 ? segment : `.${segment}`;
      } else {
        formatted += `[${JSON.stringify(segment)}]`;
      }
      continue;
    }

    formatted += `[${String(segment)}]`;
  }

  return formatted;
}

function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
