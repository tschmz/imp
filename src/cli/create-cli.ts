import { createRequire } from "node:module";
import { Command } from "commander";

export interface CliDependencies {
  startDaemon: (options: { configPath?: string }) => Promise<void>;
  viewLogs: (options: { configPath?: string; botId?: string; follow: boolean; lines: number }) => Promise<void>;
  validateConfig: (options: { configPath?: string }) => Promise<void>;
  getConfigValue: (options: { configPath?: string; keyPath: string }) => Promise<void>;
  setConfigValue: (options: { configPath?: string; keyPath: string; value: string }) => Promise<void>;
  initConfig: (options: {
    configPath?: string;
    force: boolean;
    defaults: boolean;
  }) => Promise<void>;
  installService: (options: { configPath?: string; dryRun: boolean; force: boolean }) => Promise<void>;
  uninstallService: (options: { configPath?: string }) => Promise<void>;
  startService: (options: { configPath?: string }) => Promise<void>;
  stopService: (options: { configPath?: string }) => Promise<void>;
  restartService: (options: { configPath?: string }) => Promise<void>;
  statusService: (options: { configPath?: string }) => Promise<void>;
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
    .command("log")
    .description("Show daemon log output")
    .option("-c, --config <path>", "Path to the config file")
    .option("-b, --bot <id>", "Show logs for a specific bot ID")
    .option("-f, --follow", "Follow appended log lines")
    .option("-n, --lines <count>", "Number of recent lines to show", parseIntegerOption, 50)
    .action(
      async function action(
        this: Command,
        options: { config?: string; bot?: string; follow?: boolean; lines?: number },
      ) {
        await dependencies.viewLogs({
          configPath: options.config,
          botId: options.bot,
          follow: options.follow ?? false,
          lines: options.lines ?? 50,
        });
      },
    );

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

  const configCommand = program.command("config").description("Inspect and validate config files");

  configCommand
    .command("get")
    .description("Read a value from a discovered or explicit config file")
    .argument("<keyPath>", "Dot-separated config key path")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, keyPath: string, options: { config?: string }) {
      await dependencies.getConfigValue({
        configPath: options.config,
        keyPath,
      });
    });

  configCommand
    .command("set")
    .description("Update a value in a discovered or explicit config file")
    .argument("<keyPath>", "Dot-separated config key path")
    .argument("<value>", "JSON literal/object/array or plain string value")
    .option("-c, --config <path>", "Path to the config file")
    .action(
      async function action(this: Command, keyPath: string, value: string, options: { config?: string }) {
        await dependencies.setConfigValue({
          configPath: options.config,
          keyPath,
          value,
        });
      },
    );

  configCommand
    .command("validate")
    .description("Validate a discovered or explicit config file")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.validateConfig({ configPath: options.config });
    });

  const serviceCommand = program.command("service").description("Manage imp background services");

  serviceCommand
    .command("install")
    .description("Generate or install a background service definition")
    .option("-c, --config <path>", "Path to the config file")
    .option("-f, --force", "Overwrite an existing service definition")
    .option("--dry-run", "Print the generated service definition instead of installing it")
    .action(async function action(
      this: Command,
      options: { config?: string; dryRun?: boolean; force?: boolean },
    ) {
      await dependencies.installService({
        configPath: options.config,
        dryRun: options.dryRun ?? false,
        force: options.force ?? false,
      });
    });

  serviceCommand
    .command("uninstall")
    .description("Remove an installed background service definition")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.uninstallService({
        configPath: options.config,
      });
    });

  serviceCommand
    .command("start")
    .description("Start an installed background service")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.startService({ configPath: options.config });
    });

  serviceCommand
    .command("stop")
    .description("Stop a running background service")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.stopService({ configPath: options.config });
    });

  serviceCommand
    .command("restart")
    .description("Restart an installed background service")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.restartService({ configPath: options.config });
    });

  serviceCommand
    .command("status")
    .description("Show the native status for an installed background service")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.statusService({ configPath: options.config });
    });

  return program;
}

function getCliVersion(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require("../../package.json") as { version?: string };
  return packageJson.version ?? "0.0.0";
}

function parseIntegerOption(value: string): number {
  return Number.parseInt(value, 10);
}
