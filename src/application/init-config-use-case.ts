import { createDefaultAppConfig } from "../config/default-app-config.js";
import { assertInitConfigCanBeCreated, initAppConfig } from "../config/init-app-config.js";
import { getProviderEnvironmentVariables, promptForInitialAppConfig } from "../config/prompt-init-config.js";
import { installService } from "../service/install-service.js";

export function createInitConfigUseCase(): (options: {
  configPath?: string;
  force: boolean;
  defaults: boolean;
}) => Promise<void> {
  return async ({ configPath, force, defaults }) => {
    const resolvedConfigPath = await assertInitConfigCanBeCreated({ configPath, force });
    const initSetup = defaults
      ? {
          config: undefined,
          installService: process.platform !== "win32",
          serviceEnvironment: resolveDefaultServiceEnvironment(),
        }
      : await resolveInitConfig();
    const createdConfigPath = await initAppConfig({
      configPath: resolvedConfigPath,
      force,
      config: initSetup.config,
    });
    console.log(`Created config at ${createdConfigPath}`);

    if (initSetup.installService) {
      const result = await installService({
        configPath: createdConfigPath,
        force,
        serviceEnvironment: initSetup.serviceEnvironment,
      });
      console.log(`Installed ${result.platform} service at ${result.definitionPath}`);
    }
  };
}

function resolveDefaultServiceEnvironment(): Record<string, string> | undefined {
  const defaultAgent = createDefaultAppConfig(process.env).agents[0];
  const provider = defaultAgent?.model?.provider;
  if (!provider) {
    return undefined;
  }

  const entries = getProviderEnvironmentVariables(provider)
    .map((name) => [name, process.env[name]?.trim()] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1] && entry[1].length > 0));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

async function resolveInitConfig() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`imp init` requires an interactive terminal. Re-run with --defaults to skip prompts.");
  }

  try {
    return await promptForInitialAppConfig();
  } catch (error) {
    if (isPromptExitError(error)) {
      throw new Error("Config initialization cancelled.");
    }

    throw error;
  }
}

function isPromptExitError(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}
