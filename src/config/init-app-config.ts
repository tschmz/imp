import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDefaultUserConfigPath, getDefaultUserDataRoot } from "./discover-config-path.js";

export async function initAppConfig(options: {
  configPath?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const configPath = resolve(options.configPath ?? getDefaultUserConfigPath(env));

  await mkdir(dirname(configPath), { recursive: true });
  try {
    await writeFile(configPath, `${buildDefaultConfig(env)}\n`, {
      encoding: "utf8",
      flag: options.force ? "w" : "wx",
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(`Config file already exists: ${configPath}\nRe-run with --force to overwrite.`);
    }

    throw error;
  }

  return configPath;
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
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        systemPrompt: "You are a concise and pragmatic assistant running through a local daemon.",
      },
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
