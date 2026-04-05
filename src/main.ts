#!/usr/bin/env node
import { createCli } from "./cli/create-cli.js";
import { createInitConfigUseCase } from "./application/init-config-use-case.js";
import { createRunDaemonUseCase } from "./application/run-daemon-use-case.js";
import { createServiceUseCases } from "./application/service-use-cases.js";
import { createViewLogsUseCase } from "./application/view-logs-use-case.js";

async function main(): Promise<void> {
  const serviceUseCases = createServiceUseCases();
  const cli = createCli({
    startDaemon: createRunDaemonUseCase(),
    viewLogs: createViewLogsUseCase(),
    initConfig: createInitConfigUseCase(),
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
