import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appConfigSchema } from "../config/schema.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { setValueAtKeyPath } from "./config-key-path.js";

export function createSetConfigValueUseCase(): (options: {
  configPath?: string;
  keyPath: string;
  value: string;
}) => Promise<void> {
  return async ({ configPath, keyPath, value }) => {
    const resolvedConfigPath = await resolveWritableConfigPath(configPath);
    const raw = await readFile(resolvedConfigPath, "utf8");
    const parsed = parseConfigJson(raw, resolvedConfigPath);

    assertExistingConfigIsValid(parsed, resolvedConfigPath);
    setValueAtKeyPath(parsed, keyPath, parseConfigValue(value));
    assertUpdatedConfigIsValid(parsed, resolvedConfigPath);

    await writeFile(resolvedConfigPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    console.log(`Updated config ${resolvedConfigPath}: ${keyPath}`);
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

function parseConfigJson(raw: string, absolutePath: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config file ${absolutePath}\nMalformed JSON: ${message}`);
  }
}

function assertExistingConfigIsValid(config: unknown, configPath: string): void {
  const result = appConfigSchema.safeParse(config);

  if (!result.success) {
    throw new Error(formatSchemaError(`Invalid config file ${configPath}`, result.error.issues));
  }
}

function assertUpdatedConfigIsValid(config: unknown, configPath: string): void {
  const result = appConfigSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      formatSchemaError(`Updated config would be invalid: ${configPath}`, result.error.issues),
    );
  }
}

function formatSchemaError(
  prefix: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  const details = issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("\n");
  return `${prefix}\n${details}`;
}

function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
