import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, booleanWithDefault, withAsyncAction } from "../command-helpers.js";

export function registerPluginCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const pluginCommand = programOrSubcommand.command("plugin").description("Manage plugins");

  addConfigOption(
    pluginCommand
      .command("list")
      .description("List configured and installable plugins")
      .option("--root <path>", "Plugin root directory to scan"),
  ).action(
    withAsyncAction(async (options: { config?: string; root?: string }) => {
      await deps.listPlugins({ configPath: options.config, root: options.root });
    }),
  );

  addConfigOption(
    pluginCommand
      .command("inspect")
      .description("Show a configured or installable plugin manifest")
      .argument("<plugin>", "Plugin ID")
      .option("--root <path>", "Plugin root directory to scan"),
  ).action(
    withAsyncAction(async (id: string, options: { config?: string; root?: string }) => {
      await deps.inspectPlugin({
        configPath: options.config,
        root: options.root,
        id,
      });
    }),
  );

  addConfigOption(
    pluginCommand
      .command("check")
      .description("Check a configured plugin installation")
      .argument("<plugin>", "Plugin ID"),
  ).action(
    withAsyncAction(async (id: string, options: { config?: string }) => {
      await deps.checkPlugin({
        configPath: options.config,
        id,
      });
    }),
  );

  addConfigOption(
    pluginCommand
      .command("status")
      .description("Show configured plugin health")
      .argument("<plugin>", "Plugin ID"),
  ).action(
    withAsyncAction(async (id: string, options: { config?: string }) => {
      await deps.statusPlugin({
        configPath: options.config,
        id,
      });
    }),
  );

  addConfigOption(
    pluginCommand
      .command("install")
      .description("Install or update a plugin in the config")
      .argument("<plugin>", "Plugin ID or npm package spec")
      .option("--root <path>", "Plugin root directory to scan")
      .option("--no-services", "Do not install or start plugin services")
      .option("--services-only", "Reinstall and start services for an already configured plugin")
      .option("-f, --force", "Overwrite existing plugin service definitions"),
  ).action(
    withAsyncAction(
      async (
        id: string,
        options: { config?: string; root?: string; services?: boolean; servicesOnly?: boolean; force?: boolean },
      ) => {
        await deps.installPlugin({
          configPath: options.config,
          root: options.root,
          id,
          autoStartServices: booleanWithDefault(options.services, true),
          servicesOnly: booleanWithDefault(options.servicesOnly, false),
          force: booleanWithDefault(options.force, false),
        });
      },
    ),
  );
}
