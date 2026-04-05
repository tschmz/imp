import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createDefaultAppConfig } from "./default-app-config.js";
import { getDefaultUserConfigPath } from "./discover-config-path.js";
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
  const configPath = resolve(options.configPath ?? getDefaultUserConfigPath(env));
  const config = appConfigSchema.parse(options.config ?? createDefaultAppConfig(env));

  await mkdir(dirname(configPath), { recursive: true });
  try {
    if (options.force) {
      await backupExistingConfig(configPath, options.now ?? new Date());
    }

    const file = await open(configPath, options.force ? "w" : "wx", ownerReadWriteMode);
    try {
      await file.writeFile(`${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8" });
      await file.chmod(ownerReadWriteMode);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(`Config file already exists: ${configPath}\nRe-run with --force to overwrite.`);
    }

    throw error;
  }

  return configPath;
}

async function backupExistingConfig(configPath: string, now: Date): Promise<void> {
  let sourceFile;
  try {
    sourceFile = await open(configPath, "r");
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  try {
    const content = await sourceFile.readFile({ encoding: "utf8" });
    const backupPath = `${configPath}.${formatBackupTimestamp(now)}.bak`;
    const backupFile = await open(backupPath, "w", ownerReadWriteMode);
    try {
      await backupFile.writeFile(content, { encoding: "utf8" });
      await backupFile.chmod(ownerReadWriteMode);
    } finally {
      await backupFile.close();
    }
  } finally {
    await sourceFile.close();
  }
}

function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
