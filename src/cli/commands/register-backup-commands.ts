import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, booleanWithDefault, withAsyncAction } from "../command-helpers.js";

export function registerBackupCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const backupCommand = programOrSubcommand.command("backup").description("Create, inspect, and restore backups");

  addConfigOption(
    backupCommand
      .command("create")
      .description("Create a backup archive")
      .option("-o, --output <archive>", "Path to the backup archive")
      .option("--only <scopes>", "Comma-separated scopes: config,agents,sessions,bindings")
      .option("-f, --force", "Overwrite an existing backup archive"),
  ).action(
    withAsyncAction(async (options: { config?: string; output?: string; only?: string; force?: boolean }) => {
      await deps.createBackup({
        configPath: options.config,
        outputPath: options.output,
        only: options.only,
        force: booleanWithDefault(options.force, false),
      });
    }),
  );

  backupCommand
    .command("inspect")
    .description("Inspect a backup archive")
    .argument("<archive>", "Path to the backup archive")
    .action(
      withAsyncAction(async (inputPath: string) => {
        await deps.inspectBackup({
          inputPath,
        });
      }),
    );

  addConfigOption(
    backupCommand
      .command("restore")
      .description("Restore from a backup archive")
      .argument("<archive>", "Path to the backup archive")
      .option("--data-root <path>", "Override paths.dataRoot when restoring sessions or config")
      .option(
        "--only <scopes>",
        "Comma-separated scopes: config,agents,sessions,bindings. Agents-only restore requires a restored or existing target config.",
      )
      .option("-f, --force", "Overwrite existing files"),
  ).action(
    withAsyncAction(
      async (inputPath: string, options: { config?: string; dataRoot?: string; only?: string; force?: boolean }) => {
        await deps.restoreBackup({
          configPath: options.config,
          dataRoot: options.dataRoot,
          inputPath,
          only: options.only,
          force: booleanWithDefault(options.force, false),
        });
      },
    ),
  );
}
