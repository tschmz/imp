import { assertInitConfigCanBeCreated, initAppConfig } from "../config/init-app-config.js";
import { promptForInitialAppConfig } from "../config/prompt-init-config.js";
import { installConfiguredPluginServices } from "./plugin-service-installer.js";
import { installService } from "../service/install-service.js";
import type { AppConfig } from "../config/types.js";

interface InitConfigUseCaseDependencies {
  writeOutput: (line: string) => void;
}

export function createInitConfigUseCase(
  dependencies: Partial<InitConfigUseCaseDependencies> = {},
): (options: {
  configPath?: string;
  force: boolean;
}) => Promise<void> {
  const deps: InitConfigUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath, force }) => {
    const resolvedConfigPath = await assertInitConfigCanBeCreated({ configPath, force });
    const initSetup = await resolveInitConfig();
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
    writeNextStep(initSetup.config, initSetup.installService, deps.writeOutput);
    await installConfiguredPluginServices({
      config: initSetup.config,
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
    throw new Error("`imp init` requires an interactive terminal.");
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

function writeNextStep(
  config: AppConfig,
  installedService: boolean,
  writeOutput: (line: string) => void,
): void {
  if (installedService) {
    writeOutput("imp is running. Send a message to your configured endpoint.");
    return;
  }

  const hasEnabledDaemonEndpoint = config.endpoints.some((endpoint) =>
    endpoint.enabled && endpoint.type !== "cli"
  );

  if (hasEnabledDaemonEndpoint) {
    writeOutput("Start the daemon with: imp start");
    return;
  }

  writeOutput("No daemon endpoint configured. Start local chat with: imp chat");
}
