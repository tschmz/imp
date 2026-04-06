#!/usr/bin/env node
import { createCli } from "./cli/create-cli.js";
import { createInitConfigUseCase } from "./application/init-config-use-case.js";
import { createRunDaemonUseCase } from "./application/run-daemon-use-case.js";
import { createServiceUseCases } from "./application/service-use-cases.js";
import { createViewLogsUseCase } from "./application/view-logs-use-case.js";
import { createDaemonStartupFailureReporter } from "./logging/daemon-startup-failure-reporter.js";
import { AppError, ServiceError, asAppError } from "./domain/errors.js";

const EXIT_CODE_BY_APP_ERROR: Record<AppError["code"], number> = {
  CONFIG_ERROR: 2,
  TRANSPORT_ERROR: 3,
  AGENT_EXECUTION_ERROR: 4,
  SERVICE_ERROR: 5,
  INTERNAL_ERROR: 1,
};

async function main(): Promise<void> {
  const serviceUseCases = createServiceUseCases();
  const startupFailureReporter = createDaemonStartupFailureReporter();
  const runDaemonUseCase = createRunDaemonUseCase({ startupFailureReporter });
  const cli = createCli({
    startDaemon: async (options) => {
      const outcome = await runDaemonUseCase(options);
      if (!outcome.ok) {
        throw outcome.error;
      }
    },
    viewLogs: withAppErrorHandling(createViewLogsUseCase()),
    initConfig: withAppErrorHandling(createInitConfigUseCase()),
    installService: withServiceErrorHandling(serviceUseCases.installService),
    uninstallService: withServiceErrorHandling(serviceUseCases.uninstallService),
    startService: withServiceErrorHandling(serviceUseCases.startService),
    stopService: withServiceErrorHandling(serviceUseCases.stopService),
    restartService: withServiceErrorHandling(serviceUseCases.restartService),
    statusService: withServiceErrorHandling(serviceUseCases.statusService),
  });

  if (process.argv.length <= 2) {
    cli.outputHelp();
    return;
  }

  await cli.parseAsync(process.argv);
}

function withServiceErrorHandling<TOptions>(
  command: (options: TOptions) => Promise<void>,
): (options: TOptions) => Promise<void> {
  return async (options) => {
    try {
      await command(options);
    } catch (error) {
      const serviceCause = asAppError(error, { code: "SERVICE_ERROR" });
      throw new ServiceError(serviceCause.message, {
        cause: serviceCause,
        details: serviceCause.details,
      });
    }
  };
}

function withAppErrorHandling<TOptions>(
  command: (options: TOptions) => Promise<void>,
): (options: TOptions) => Promise<void> {
  return async (options) => {
    try {
      await command(options);
    } catch (error) {
      throw asAppError(error);
    }
  };
}

function presentCliError(error: unknown): void {
  const appError = asAppError(error);
  const code = EXIT_CODE_BY_APP_ERROR[appError.code] ?? 1;

  console.error(appError.message);
  if (appError.details && Object.keys(appError.details).length > 0) {
    console.error(JSON.stringify(appError.details));
  }
  process.exitCode = code;
}

main().catch((error: unknown) => {
  presentCliError(error);
});
