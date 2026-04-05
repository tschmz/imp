import { createRequire } from "node:module";
import { Command } from "commander";

export interface CliDependencies {
  startDaemon: (options: { configPath?: string }) => Promise<void>;
  initConfig: (options: { configPath?: string; force: boolean }) => Promise<void>;
}

export function createCli(dependencies: CliDependencies): Command {
  const program = new Command();

  program
    .name("imp")
    .description("Run and manage imp agent daemons")
    .option("-c, --config <path>", "Path to the config file")
    .showHelpAfterError()
    .version(getCliVersion());

  program
    .command("start")
    .description("Start the imp daemon")
    .action(async function action(this: Command) {
      const options = this.optsWithGlobals<{ config?: string }>();
      await dependencies.startDaemon({ configPath: options.config });
    });

  program
    .command("init")
    .description("Create an initial config file")
    .option("-f, --force", "Overwrite an existing config file")
    .action(async function action(this: Command, options: { force?: boolean }) {
      const globalOptions = this.optsWithGlobals<{ config?: string }>();
      await dependencies.initConfig({
        configPath: globalOptions.config,
        force: options.force ?? false,
      });
    });

  return program;
}

function getCliVersion(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require("../../package.json") as { version?: string };
  return packageJson.version ?? "0.0.0";
}
