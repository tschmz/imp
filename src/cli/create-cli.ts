import { createRequire } from "node:module";
import { Command } from "commander";

export interface CliDependencies {
  startDaemon: (options: { configPath?: string }) => Promise<void>;
  initConfig: (options: {
    configPath?: string;
    force: boolean;
    defaults: boolean;
  }) => Promise<void>;
}

export function createCli(dependencies: CliDependencies): Command {
  const program = new Command();

  program
    .name("imp")
    .description("Run and manage imp agent daemons")
    .showHelpAfterError()
    .version(getCliVersion());

  program
    .command("start")
    .description("Start the imp daemon")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.startDaemon({ configPath: options.config });
    });

  program
    .command("init")
    .description("Create an initial config file")
    .option("-c, --config <path>", "Path to the config file")
    .option("-f, --force", "Overwrite an existing config file")
    .option("--defaults", "Skip prompts and write the default config template")
    .action(async function action(
      this: Command,
      options: { config?: string; force?: boolean; defaults?: boolean },
    ) {
      await dependencies.initConfig({
        configPath: options.config,
        force: options.force ?? false,
        defaults: options.defaults ?? false,
      });
    });

  return program;
}

function getCliVersion(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require("../../package.json") as { version?: string };
  return packageJson.version ?? "0.0.0";
}
