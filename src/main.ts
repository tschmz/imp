#!/usr/bin/env node
import type { RunDaemonOutcome } from "./application/run-daemon-use-case.js";
import { createCli, type CliDependencies } from "./cli/create-cli.js";
import {
  ConfigurationError,
  RuntimeStateError,
  TransportResolutionError,
  UnsupportedPlatformError,
} from "./domain/errors.js";

const EXIT_CODES = {
  unknown: 1,
  configuration: 2,
  unsupportedPlatform: 3,
  transportResolution: 4,
  runtimeState: 5,
} as const;

async function main(): Promise<void> {
  const cli = createCli(createLazyCliDependencies());

  if (process.argv.length <= 2) {
    cli.outputHelp();
    return;
  }

  await cli.parseAsync(process.argv);
}

function createLazyCliDependencies(): CliDependencies {
  const runDaemonUseCase = createLazyValue(async () => {
    const [{ createRunDaemonUseCase }, { createDaemonStartupFailureReporter }] = await Promise.all([
      import("./application/run-daemon-use-case.js"),
      import("./logging/daemon-startup-failure-reporter.js"),
    ]);
    const startupFailureReporter = createDaemonStartupFailureReporter();
    const runDaemon = createRunDaemonUseCase({ startupFailureReporter });

    return async (options: Parameters<CliDependencies["startDaemon"]>[0]) => {
      const outcome = await runDaemon(options);
      presentRunDaemonOutcome(outcome);
    };
  });
  const chatUseCase = createLazyUseCase(async () => (await import("./application/chat-use-case.js")).createChatUseCase());
  const viewLogsUseCase = createLazyUseCase(
    async () => (await import("./application/view-logs-use-case.js")).createViewLogsUseCase(),
  );
  const validateConfigUseCase = createLazyUseCase(
    async () => (await import("./application/validate-config-use-case.js")).createValidateConfigUseCase(),
  );
  const showConfigSchemaUseCase = createLazyUseCase(
    async () => (await import("./application/config-schema-use-case.js")).createConfigSchemaUseCase(),
  );
  const reloadConfigUseCase = createLazyUseCase(
    async () => (await import("./application/reload-config-use-case.js")).createReloadConfigUseCase(),
  );
  const getConfigValueUseCase = createLazyUseCase(
    async () => (await import("./application/get-config-value-use-case.js")).createGetConfigValueUseCase(),
  );
  const setConfigValueUseCase = createLazyUseCase(
    async () => (await import("./application/set-config-value-use-case.js")).createSetConfigValueUseCase(),
  );
  const initConfigUseCase = createLazyUseCase(
    async () => (await import("./application/init-config-use-case.js")).createInitConfigUseCase(),
  );
  const syncManagedSkillsUseCase = createLazyUseCase(
    async () => (await import("./application/sync-managed-skills-use-case.js")).createSyncManagedSkillsUseCase(),
  );
  const backupUseCases = createLazyValue(async () => (await import("./application/backup-use-cases.js")).createBackupUseCases());
  const pluginUseCases = createLazyValue(async () => (await import("./application/plugin-use-cases.js")).createPluginUseCases());
  const serviceUseCases = createLazyValue(async () => (await import("./application/service-use-cases.js")).createServiceUseCases());

  return {
    startDaemon: async (options) => {
      await (await runDaemonUseCase())(options);
    },
    startChat: chatUseCase,
    viewLogs: viewLogsUseCase,
    validateConfig: validateConfigUseCase,
    showConfigSchema: showConfigSchemaUseCase,
    reloadConfig: reloadConfigUseCase,
    getConfigValue: getConfigValueUseCase,
    setConfigValue: setConfigValueUseCase,
    initConfig: initConfigUseCase,
    syncManagedSkills: syncManagedSkillsUseCase,
    createBackup: async (options) => {
      await (await backupUseCases()).createBackup(options);
    },
    inspectBackup: async (options) => {
      await (await backupUseCases()).inspectBackup(options);
    },
    restoreBackup: async (options) => {
      await (await backupUseCases()).restoreBackup(options);
    },
    listPlugins: async (options) => {
      await (await pluginUseCases()).listPlugins(options);
    },
    inspectPlugin: async (options) => {
      await (await pluginUseCases()).inspectPlugin(options);
    },
    checkPlugin: async (options) => {
      await (await pluginUseCases()).doctorPlugin(options);
    },
    statusPlugin: async (options) => {
      await (await pluginUseCases()).statusPlugin(options);
    },
    installPlugin: async (options) => {
      await (await pluginUseCases()).installPlugin(options);
    },
    installService: async (options) => {
      await (await serviceUseCases()).installService(options);
    },
    uninstallService: async (options) => {
      await (await serviceUseCases()).uninstallService(options);
    },
    startService: async (options) => {
      await (await serviceUseCases()).startService(options);
    },
    stopService: async (options) => {
      await (await serviceUseCases()).stopService(options);
    },
    restartService: async (options) => {
      await (await serviceUseCases()).restartService(options);
    },
    statusService: async (options) => {
      await (await serviceUseCases()).statusService(options);
    },
  };
}

function createLazyUseCase<TArgs extends unknown[]>(
  createUseCase: () => Promise<(...args: TArgs) => Promise<void>>,
): (...args: TArgs) => Promise<void> {
  const lazyUseCase = createLazyValue(createUseCase);

  return async (...args: TArgs) => {
    await (await lazyUseCase())(...args);
  };
}

function createLazyValue<TValue>(createValue: () => Promise<TValue>): () => Promise<TValue> {
  let value: Promise<TValue> | undefined;

  return () => {
    value ??= createValue();
    return value;
  };
}

function presentRunDaemonOutcome(outcome: RunDaemonOutcome): void {
  if (outcome.status === "started") {
    return;
  }

  presentCliError(outcome.error);
}

function presentCliError(error: unknown): void {
  const normalizedError = normalizeCliError(error);
  console.error(`${normalizedError.label}: ${normalizedError.message}`);
  process.exitCode = normalizedError.exitCode;
}

function normalizeCliError(error: unknown): { label: string; message: string; exitCode: number } {
  if (error instanceof ConfigurationError) {
    return {
      label: "Configuration error",
      message: error.message,
      exitCode: EXIT_CODES.configuration,
    };
  }

  if (error instanceof UnsupportedPlatformError) {
    return {
      label: "Unsupported platform",
      message: error.message,
      exitCode: EXIT_CODES.unsupportedPlatform,
    };
  }

  if (error instanceof TransportResolutionError) {
    return {
      label: "Transport resolution error",
      message: error.message,
      exitCode: EXIT_CODES.transportResolution,
    };
  }

  if (error instanceof RuntimeStateError) {
    return {
      label: "Runtime state error",
      message: error.message,
      exitCode: EXIT_CODES.runtimeState,
    };
  }

  if (error instanceof Error) {
    if (isUserFacingUsageError(error)) {
      return {
        label: "Configuration error",
        message: error.message,
        exitCode: EXIT_CODES.configuration,
      };
    }

    return {
      label: "Unexpected error",
      message: error.message,
      exitCode: EXIT_CODES.unknown,
    };
  }

  return {
    label: "Unexpected error",
    message: String(error),
    exitCode: EXIT_CODES.unknown,
  };
}

function isUserFacingUsageError(error: Error): boolean {
  return (
    error.message.includes("already exists:") ||
    error.message.includes("already configured.") ||
    error.message.includes("is not configured.") ||
    error.message.includes("does not have a package path") ||
    error.message.includes("Re-run with --force") ||
    error.message.includes("was not found.")
  );
}

main().catch((error: unknown) => {
  presentCliError(error);
});
