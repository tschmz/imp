#!/usr/bin/env node
import { createBackupUseCases } from "./application/backup-use-cases.js";
import { createChatUseCase } from "./application/chat-use-case.js";
import { createConfigSchemaUseCase } from "./application/config-schema-use-case.js";
import { createGetConfigValueUseCase } from "./application/get-config-value-use-case.js";
import { createInitConfigUseCase } from "./application/init-config-use-case.js";
import { createPluginUseCases } from "./application/plugin-use-cases.js";
import { createReloadConfigUseCase } from "./application/reload-config-use-case.js";
import { createRunDaemonUseCase, type RunDaemonOutcome } from "./application/run-daemon-use-case.js";
import { createServiceUseCases } from "./application/service-use-cases.js";
import { createSetConfigValueUseCase } from "./application/set-config-value-use-case.js";
import { createSyncManagedSkillsUseCase } from "./application/sync-managed-skills-use-case.js";
import { createValidateConfigUseCase } from "./application/validate-config-use-case.js";
import { createViewLogsUseCase } from "./application/view-logs-use-case.js";
import { createCli } from "./cli/create-cli.js";
import {
  ConfigurationError,
  RuntimeStateError,
  TransportResolutionError,
  UnsupportedPlatformError,
} from "./domain/errors.js";
import { createDaemonStartupFailureReporter } from "./logging/daemon-startup-failure-reporter.js";

const EXIT_CODES = {
  unknown: 1,
  configuration: 2,
  unsupportedPlatform: 3,
  transportResolution: 4,
  runtimeState: 5,
} as const;

async function main(): Promise<void> {
  const serviceUseCases = createServiceUseCases();
  const startupFailureReporter = createDaemonStartupFailureReporter();
  const runDaemonUseCase = createRunDaemonUseCase({ startupFailureReporter });
  const validateConfigUseCase = createValidateConfigUseCase();
  const backupUseCases = createBackupUseCases();
  const pluginUseCases = createPluginUseCases();
  const cli = createCli({
    startDaemon: async (options) => {
      const outcome = await runDaemonUseCase(options);
      presentRunDaemonOutcome(outcome);
    },
    startChat: createChatUseCase(),
    viewLogs: createViewLogsUseCase(),
    validateConfig: validateConfigUseCase,
    showConfigSchema: createConfigSchemaUseCase(),
    reloadConfig: createReloadConfigUseCase(),
    getConfigValue: createGetConfigValueUseCase(),
    setConfigValue: createSetConfigValueUseCase(),
    initConfig: createInitConfigUseCase(),
    syncManagedSkills: createSyncManagedSkillsUseCase(),
    createBackup: backupUseCases.createBackup,
    inspectBackup: backupUseCases.inspectBackup,
    restoreBackup: backupUseCases.restoreBackup,
    listPlugins: pluginUseCases.listPlugins,
    inspectPlugin: pluginUseCases.inspectPlugin,
    doctorPlugin: pluginUseCases.doctorPlugin,
    statusPlugin: pluginUseCases.statusPlugin,
    installPlugin: pluginUseCases.installPlugin,
    updatePlugin: pluginUseCases.updatePlugin,
    installService: serviceUseCases.installService,
    uninstallService: serviceUseCases.uninstallService,
    startService: serviceUseCases.startService,
    stopService: serviceUseCases.stopService,
    restartService: serviceUseCases.restartService,
    statusService: serviceUseCases.statusService,
  });

  if (process.argv.length <= 2) {
    cli.outputHelp();
    return;
  }

  await cli.parseAsync(process.argv);
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
