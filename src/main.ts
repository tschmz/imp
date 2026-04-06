#!/usr/bin/env node
import { createCli } from "./cli/create-cli.js";
import { createInitConfigUseCase } from "./application/init-config-use-case.js";
import { createGetConfigValueUseCase } from "./application/get-config-value-use-case.js";
import { createSetConfigValueUseCase } from "./application/set-config-value-use-case.js";
import { createReloadConfigUseCase } from "./application/reload-config-use-case.js";
import { createRunDaemonUseCase, type RunDaemonOutcome } from "./application/run-daemon-use-case.js";
import { createServiceUseCases } from "./application/service-use-cases.js";
import { createValidateConfigUseCase } from "./application/validate-config-use-case.js";
import { createViewLogsUseCase } from "./application/view-logs-use-case.js";
import { createDaemonStartupFailureReporter } from "./logging/daemon-startup-failure-reporter.js";
import { createBackupUseCases } from "./application/backup-use-cases.js";

async function main(): Promise<void> {
  const serviceUseCases = createServiceUseCases();
  const startupFailureReporter = createDaemonStartupFailureReporter();
  const runDaemonUseCase = createRunDaemonUseCase({ startupFailureReporter });
  const validateConfigUseCase = createValidateConfigUseCase();
  const backupUseCases = createBackupUseCases();
  const cli = createCli({
    startDaemon: async (options) => {
      const outcome = await runDaemonUseCase(options);
      presentRunDaemonOutcome(outcome);
    },
    viewLogs: createViewLogsUseCase(),
    validateConfig: validateConfigUseCase,
    reloadConfig: createReloadConfigUseCase(),
    getConfigValue: createGetConfigValueUseCase(),
    setConfigValue: createSetConfigValueUseCase(),
    initConfig: createInitConfigUseCase(),
    createBackup: backupUseCases.createBackup,
    restoreBackup: backupUseCases.restoreBackup,
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

  console.error(outcome.error instanceof Error ? outcome.error.message : outcome.error);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
