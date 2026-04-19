import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AppConfig } from "./types.js";
import { appConfigSchema } from "./schema.js";
import { parseConfigJson } from "./config-json.js";
import { resolveConfigPath } from "./secret-value.js";

export async function loadAppConfig(configPath: string): Promise<AppConfig> {
  const absolutePath = resolve(configPath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = parseConfigJson(raw, { errorPrefix: `Invalid config file ${absolutePath}` });
  const result = appConfigSchema.safeParse(parsed);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid config file ${absolutePath}\n${details}`);
  }

  return resolveLoadedAppConfig(result.data, absolutePath);
}

function resolveLoadedAppConfig(config: AppConfig, configPath: string): AppConfig {
  const configDir = dirname(configPath);

  return {
    ...config,
    paths: {
      ...config.paths,
      dataRoot: resolveConfigPath(config.paths.dataRoot, configDir),
    },
  };
}
