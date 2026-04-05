import { resolve } from "node:path";
import { createDefaultAppConfig } from "./default-app-config.js";
import { getDefaultUserConfigPath } from "./discover-config-path.js";
import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import { appConfigSchema } from "./schema.js";
import type { AppConfig } from "./types.js";

const ownerReadWriteMode = 0o600;

export async function initAppConfig(options: {
  configPath?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  config?: AppConfig;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const configPath = resolveConfigPath({ configPath: options.configPath, env });
  const config = appConfigSchema.parse(options.config ?? createDefaultAppConfig(env));

  return writeManagedFile({
    path: configPath,
    resourceLabel: "Config file",
    content: `${JSON.stringify(config, null, 2)}\n`,
    force: options.force,
    now: options.now,
    mode: ownerReadWriteMode,
  });
}

export async function assertInitConfigCanBeCreated(options: {
  configPath?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<string> {
  return assertManagedFileCanBeWritten({
    path: resolveConfigPath(options),
    resourceLabel: "Config file",
    force: options.force,
  });
}

function resolveConfigPath(options: {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = options.env ?? process.env;
  return resolve(options.configPath ?? getDefaultUserConfigPath(env));
}
