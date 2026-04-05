import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDefaultUserConfigPath, getDefaultUserDataRoot } from "./discover-config-path.js";

const ownerReadWriteMode = 0o600;

export async function initAppConfig(options: {
  configPath?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const configPath = resolve(options.configPath ?? getDefaultUserConfigPath(env));

  await mkdir(dirname(configPath), { recursive: true });
  try {
    if (options.force) {
      await backupExistingConfig(configPath, options.now ?? new Date());
    }

    const file = await open(configPath, options.force ? "w" : "wx", ownerReadWriteMode);
    try {
      await file.writeFile(`${buildDefaultConfig(env)}\n`, { encoding: "utf8" });
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

function buildDefaultConfig(env: NodeJS.ProcessEnv): string {
  return JSON.stringify(
    {
      instance: {
        name: "default",
      },
      paths: {
        dataRoot: getDefaultUserDataRoot(env),
      },
      logging: {
        level: "info",
      },
      defaults: {
        agentId: "default",
      },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
          inference: {
            metadata: {
              app: "imp",
            },
            request: {
              store: true,
            },
          },
          systemPrompt:
            "You are a concise and pragmatic assistant running through a local daemon.",
        },
      ],
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "replace-me",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    },
    null,
    2,
  );
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
