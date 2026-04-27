import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, withAsyncAction } from "../command-helpers.js";

export function registerConfigCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const configCommand = programOrSubcommand
    .command("config")
    .description("Inspect, reload, and validate config files");

  addConfigOption(
    configCommand
      .command("get")
      .description("Read an effective value from a discovered or explicit config file")
      .argument("<keyPath>", "Dot-separated config key path; use * to select multiple values"),
  ).action(
    withAsyncAction(async (keyPath: string, options: { config?: string }) => {
      await deps.getConfigValue({
        configPath: options.config,
        keyPath,
      });
    }),
  );

  addConfigOption(
    configCommand
      .command("set")
      .description("Update a value in a discovered or explicit config file")
      .argument("<keyPath>", "Dot-separated config key path")
      .argument("<value>", "JSON literal/object/array or plain string value"),
  ).action(
    withAsyncAction(async (keyPath: string, value: string, options: { config?: string }) => {
      await deps.setConfigValue({
        configPath: options.config,
        keyPath,
        value,
      });
    }),
  );

  addConfigOption(
    configCommand
      .command("validate")
      .description("Validate a discovered or explicit config file")
      .option("--preflight", "Also resolve runtime agent config, tools, and prompt files"),
  ).action(
    withAsyncAction(async (options: { config?: string; preflight?: boolean }) => {
      await deps.validateConfig({ configPath: options.config, preflight: options.preflight });
    }),
  );

  configCommand.command("schema").description("Print the Imp config JSON Schema").action(
    withAsyncAction(async () => {
      await deps.showConfigSchema();
    }),
  );

  addConfigOption(
    configCommand.command("reload").description("Reload a discovered or explicit config in the installed service"),
  ).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.reloadConfig({ configPath: options.config });
    }),
  );
}
