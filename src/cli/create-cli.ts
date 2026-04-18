import { createRequire } from "node:module";
import { Command, InvalidArgumentError } from "commander";
import type { CliDependencies } from "./cli-dependencies.js";
import { registerBackupCommands } from "./commands/register-backup-commands.js";
import { registerConfigCommands } from "./commands/register-config-commands.js";
import { registerPluginCommands } from "./commands/register-plugin-commands.js";
import { registerServiceCommands } from "./commands/register-service-commands.js";
import { addConfigOption, booleanWithDefault, withAsyncAction } from "./command-helpers.js";

export type { CliDependencies } from "./cli-dependencies.js";

export function createCli(dependencies: CliDependencies): Command {
  const program = new Command();

  program
    .name("imp")
    .description("Run and manage imp agent daemons")
    .showHelpAfterError()
    .version(getCliVersion());

  addConfigOption(program.command("start").description("Start the imp daemon")).action(
    withAsyncAction(async (options: { config?: string }) => {
      await dependencies.startDaemon({ configPath: options.config });
    }),
  );

  addConfigOption(
    program
      .command("chat")
      .description("Start an interactive CLI chat endpoint")
      .option("-b, --endpoint <id>", "CLI endpoint ID to use"),
  ).action(
    withAsyncAction(async (options: { config?: string; endpoint?: string }) => {
      await dependencies.startChat({
        configPath: options.config,
        endpointId: options.endpoint,
      });
    }),
  );

  addConfigOption(
    program
      .command("log")
      .description("Show daemon log output")
      .option("-b, --endpoint <id>", "Show logs for a specific endpoint ID")
      .option("-f, --follow", "Follow appended log lines")
      .option("-n, --lines <count>", "Number of recent lines to show", parsePositiveIntegerOption, 50),
  ).action(
    withAsyncAction(async (options: { config?: string; endpoint?: string; follow?: boolean; lines?: number }) => {
      await dependencies.viewLogs({
        configPath: options.config,
        endpointId: options.endpoint,
        follow: booleanWithDefault(options.follow, false),
        lines: options.lines ?? 50,
      });
    }),
  );

  addConfigOption(
    program
      .command("init")
      .description("Create an initial config file")
      .option("-f, --force", "Overwrite an existing config file")
      .option("--defaults", "Skip prompts and write the default config template"),
  ).action(
    withAsyncAction(async (options: { config?: string; force?: boolean; defaults?: boolean }) => {
      await dependencies.initConfig({
        configPath: options.config,
        force: booleanWithDefault(options.force, false),
        defaults: booleanWithDefault(options.defaults, false),
      });
    }),
  );

  registerConfigCommands(program, dependencies);
  registerBackupCommands(program, dependencies);
  registerPluginCommands(program, dependencies);
  registerServiceCommands(program, dependencies);

  return program;
}

function getCliVersion(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require("../../package.json") as { version?: string };
  return packageJson.version ?? "0.0.0";
}

export function parseIntegerOption(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new InvalidArgumentError("Expected an integer.");
  }

  return Number.parseInt(value, 10);
}

export function parsePositiveIntegerOption(value: string): number {
  const parsed = parseIntegerOption(value);

  if (parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }

  return parsed;
}
