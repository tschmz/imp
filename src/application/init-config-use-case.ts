import { assertInitConfigCanBeCreated, initAppConfig } from "../config/init-app-config.js";
import { createDefaultAppConfig } from "../config/default-app-config.js";
import { promptForInitialAppConfig } from "../config/prompt-init-config.js";
import { installConfiguredPluginServices } from "./plugin-service-installer.js";
import { installService } from "../service/install-service.js";

interface InitConfigUseCaseDependencies {
  writeOutput: (line: string) => void;
}

export function createInitConfigUseCase(
  dependencies: Partial<InitConfigUseCaseDependencies> = {},
): (options: {
  configPath?: string;
  force: boolean;
  defaults: boolean;
}) => Promise<void> {
  const deps: InitConfigUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath, force, defaults }) => {
    const resolvedConfigPath = await assertInitConfigCanBeCreated({ configPath, force });
    const initSetup = defaults
      ? {
          config: undefined,
          installService: false,
          serviceEnvironment: undefined,
        }
      : await resolveInitConfig();
    const createdConfigPath = await initAppConfig({
      configPath: resolvedConfigPath,
      force,
      config: initSetup.config,
    });
    deps.writeOutput(`Created config at ${createdConfigPath}`);

    if (initSetup.installService) {
      const result = await installService({
        configPath: createdConfigPath,
        force,
        serviceEnvironment: initSetup.serviceEnvironment,
      });
      deps.writeOutput(`Installed ${result.operation.platform} service at ${result.operation.definitionPath}`);
    }
    await installConfiguredPluginServices({
      config: initSetup.config ?? createDefaultAppConfig(process.env),
      configPath: createdConfigPath,
      force,
      dependencies: {
        writeOutput: deps.writeOutput,
      },
    });
  };
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
