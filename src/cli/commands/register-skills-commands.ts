import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, withAsyncAction } from "../command-helpers.js";

export function registerSkillsCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const skillsCommand = programOrSubcommand.command("skill").description("Manage skills");

  addConfigOption(
    skillsCommand.command("sync").description("Refresh bundled managed skills"),
  ).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.syncManagedSkills({ configPath: options.config });
    }),
  );
}
