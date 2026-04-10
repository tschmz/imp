import { createRequire } from "node:module";
import { Command, InvalidArgumentError } from "commander";

export interface CliDependencies {
  startDaemon: (options: { configPath?: string }) => Promise<void>;
  viewLogs: (options: { configPath?: string; botId?: string; follow: boolean; lines: number }) => Promise<void>;
  validateConfig: (options: { configPath?: string }) => Promise<void>;
  reloadConfig: (options: { configPath?: string }) => Promise<void>;
  getConfigValue: (options: { configPath?: string; keyPath: string }) => Promise<void>;
  setConfigValue: (options: { configPath?: string; keyPath: string; value: string }) => Promise<void>;
  initConfig: (options: {
    configPath?: string;
    force: boolean;
    defaults: boolean;
  }) => Promise<void>;
  createBackup: (options: {
    configPath?: string;
    outputPath?: string;
    only?: string;
    force: boolean;
  }) => Promise<void>;
  restoreBackup: (options: {
    configPath?: string;
    dataRoot?: string;
    inputPath: string;
    only?: string;
    force: boolean;
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
    .option("-n, --lines <count>", "Number of recent lines to show", parsePositiveIntegerOption, 50)
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

  const configCommand = program.command("config").description("Inspect, reload, and validate config files");

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

  configCommand
    .command("reload")
    .description("Reload a discovered or explicit config in the installed service")
    .option("-c, --config <path>", "Path to the config file")
    .action(async function action(this: Command, options: { config?: string }) {
      await dependencies.reloadConfig({ configPath: options.config });
    });

  const backupCommand = program.command("backup").description("Create and inspect imp backup archives");

  backupCommand
    .command("create")
    .description("Create a backup archive from config, agent files, and conversation data")
    .option("-c, --config <path>", "Path to the config file")
    .option("-o, --output <path>", "Path to the backup archive")
    .option("--only <scopes>", "Comma-separated scopes: config,agents,conversations")
    .option("-f, --force", "Overwrite an existing backup archive")
    .action(async function action(
      this: Command,
      options: { config?: string; output?: string; only?: string; force?: boolean },
    ) {
      await dependencies.createBackup({
        configPath: options.config,
        outputPath: options.output,
        only: options.only,
        force: options.force ?? false,
      });
    });

  program
    .command("restore")
    .description("Restore config, agent files, and conversations from a backup archive")
    .argument("<inputPath>", "Path to the backup archive")
    .option("-c, --config <path>", "Target config path")
    .option("--data-root <path>", "Override paths.dataRoot when restoring conversations or config")
    .option(
      "--only <scopes>",
      "Comma-separated scopes: config,agents,conversations. Agents-only restore requires a restored or existing target config.",
    )
    .option("-f, --force", "Overwrite existing files")
    .action(async function action(
      this: Command,
      inputPath: string,
      options: { config?: string; dataRoot?: string; only?: string; force?: boolean },
    ) {
      await dependencies.restoreBackup({
        configPath: options.config,
        dataRoot: options.dataRoot,
        inputPath,
        only: options.only,
        force: options.force ?? false,
      });
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
