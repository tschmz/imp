import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, booleanWithDefault, withAsyncAction } from "../command-helpers.js";

export function registerServiceCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const serviceCommand = programOrSubcommand.command("service").description("Manage background services");

  addConfigOption(
    serviceCommand
      .command("install")
      .description("Install a background service definition")
      .option("-f, --force", "Overwrite an existing service definition")
      .option("--dry-run", "Print the generated service definition instead of installing it"),
  ).action(
    withAsyncAction(async (options: { config?: string; dryRun?: boolean; force?: boolean }) => {
      await deps.installService({
        configPath: options.config,
        dryRun: booleanWithDefault(options.dryRun, false),
        force: booleanWithDefault(options.force, false),
      });
    }),
  );

  addConfigOption(serviceCommand.command("uninstall").description("Remove an installed background service definition")).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.uninstallService({ configPath: options.config });
    }),
  );

  addConfigOption(serviceCommand.command("start").description("Start an installed background service")).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.startService({ configPath: options.config });
    }),
  );

  addConfigOption(serviceCommand.command("stop").description("Stop a running background service")).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.stopService({ configPath: options.config });
    }),
  );

  addConfigOption(serviceCommand.command("restart").description("Restart an installed background service")).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.restartService({ configPath: options.config });
    }),
  );

  addConfigOption(serviceCommand.command("status").description("Show background service status")).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.statusService({ configPath: options.config });
    }),
  );
}
