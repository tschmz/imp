import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, booleanWithDefault, withAsyncAction } from "../command-helpers.js";

export function registerPluginCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const pluginCommand = programOrSubcommand.command("plugin").description("Inspect installable imp plugins");

  pluginCommand
    .command("list")
    .description("List installable plugins")
    .option("--root <path>", "Plugin root directory to scan")
    .action(
      withAsyncAction(async (options: { root?: string }) => {
        await deps.listPlugins({ root: options.root });
      }),
    );

  pluginCommand
    .command("inspect")
    .description("Show an installable plugin manifest")
    .argument("<id>", "Plugin ID")
    .option("--root <path>", "Plugin root directory to scan")
    .action(
      withAsyncAction(async (id: string, options: { root?: string }) => {
        await deps.inspectPlugin({
          root: options.root,
          id,
        });
      }),
    );

  addConfigOption(
    pluginCommand
      .command("doctor")
      .description("Check a configured plugin installation")
      .argument("<id>", "Plugin ID"),
  ).action(
    withAsyncAction(async (id: string, options: { config?: string }) => {
      await deps.doctorPlugin({
        configPath: options.config,
        id,
      });
    }),
  );

  addConfigOption(
    pluginCommand
      .command("status")
      .description("Show configured plugin health")
      .argument("<id>", "Plugin ID"),
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
      .description("Install a plugin manifest into the config")
      .argument("<id>", "Plugin ID or npm package spec")
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
