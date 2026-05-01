import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, withAsyncAction } from "../command-helpers.js";

export function registerConfigCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const configCommand = programOrSubcommand
    .command("config")
    .description("Inspect and update config");

  addConfigOption(
    configCommand
      .command("get")
      .description("Print a config value")
      .argument("<key-path>", "Dot-separated config key path; use * to select multiple values"),
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
      .description("Update a config value")
      .argument("<key-path>", "Dot-separated config key path")
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
      .description("Validate config")
      .option("--preflight", "Also resolve runtime agent config, tools, and prompt files"),
  ).action(
    withAsyncAction(async (options: { config?: string; preflight?: boolean }) => {
      await deps.validateConfig({ configPath: options.config, preflight: options.preflight });
    }),
  );

  configCommand.command("schema").description("Print the config JSON Schema").action(
    withAsyncAction(async () => {
      await deps.showConfigSchema();
    }),
  );

  addConfigOption(
    configCommand.command("reload").description("Reload config by restarting the service"),
  ).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.reloadConfig({ configPath: options.config });
    }),
  );
}
