import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, booleanWithDefault, withAsyncAction } from "../command-helpers.js";

export function registerBackupCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const backupCommand = programOrSubcommand.command("backup").description("Create and inspect imp backup archives");

  addConfigOption(
    backupCommand
      .command("create")
      .description("Create a backup archive from config, agent files, and conversation data")
      .option("-o, --output <path>", "Path to the backup archive")
      .option("--only <scopes>", "Comma-separated scopes: config,agents,conversations")
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

  addConfigOption(
    programOrSubcommand
      .command("restore")
      .description("Restore config, agent files, and conversations from a backup archive")
      .argument("<inputPath>", "Path to the backup archive")
      .option("--data-root <path>", "Override paths.dataRoot when restoring conversations or config")
      .option(
        "--only <scopes>",
        "Comma-separated scopes: config,agents,conversations. Agents-only restore requires a restored or existing target config.",
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
