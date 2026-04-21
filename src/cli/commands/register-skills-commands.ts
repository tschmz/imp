import type { Command } from "commander";
import type { CliDependencies } from "../cli-dependencies.js";
import { addConfigOption, withAsyncAction } from "../command-helpers.js";

export function registerSkillsCommands(programOrSubcommand: Command, deps: CliDependencies): void {
  const skillsCommand = programOrSubcommand.command("skills").description("Inspect and update managed skills");

  addConfigOption(
    skillsCommand.command("sync-managed").description("Refresh managed skills from the installed imp package"),
  ).action(
    withAsyncAction(async (options: { config?: string }) => {
      await deps.syncManagedSkills({ configPath: options.config });
    }),
  );
}
