import { join } from "node:path";
import { discoverSkills, mergeSkillCatalogs } from "../../skills/discovery.js";
import type { InboundProcessingContext } from "./types.js";

export async function resolveSkills(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent) {
    return;
  }

  const configuredSkillCatalog = context.agent.skillCatalog ?? [];
  const workspaceDirectory = resolveWorkspaceDirectory(context);
  const workspaceSkillsPath = workspaceDirectory ? join(workspaceDirectory, ".skills") : undefined;

  try {
    const workspaceSkillCatalog = workspaceSkillsPath
      ? await discoverSkills([workspaceSkillsPath], { ignoreMissingPaths: true })
      : { skills: [], issues: [] };
    const mergedSkillCatalog = mergeSkillCatalogs(configuredSkillCatalog, workspaceSkillCatalog.skills);
    const skillCatalog = mergedSkillCatalog.skills;

    context.availableSkills = skillCatalog;

    for (const issue of workspaceSkillCatalog.issues) {
      await context.dependencies.logger?.info(issue, {
        botId: context.message.botId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        workspaceDirectory,
        workspaceSkillsPath,
      });
    }

    if (mergedSkillCatalog.overriddenSkillNames.length > 0) {
      await context.dependencies.logger?.info("workspace skills override configured agent skills for turn", {
        botId: context.message.botId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        workspaceDirectory,
        workspaceSkillsPath,
        overriddenSkillNames: mergedSkillCatalog.overriddenSkillNames,
      });
    }

    await context.dependencies.logger?.debug("resolved available agent skills for turn", {
      botId: context.message.botId,
      transport: context.message.conversation.transport,
      conversationId: context.message.conversation.externalId,
      messageId: context.message.messageId,
      correlationId: context.message.correlationId,
      agentId: context.agent.id,
      skillCount: skillCatalog.length,
      skillNames: skillCatalog.map((skill) => skill.name),
      ...(workspaceDirectory ? { workspaceDirectory, workspaceSkillsPath } : {}),
      ...(mergedSkillCatalog.overriddenSkillNames.length > 0
        ? { overriddenSkillNames: mergedSkillCatalog.overriddenSkillNames }
        : {}),
    });

  } catch (error) {
    context.availableSkills = [];
    void context.dependencies.logger?.error(
      "failed to resolve available agent skills for turn; continuing without skills",
      {
        botId: context.message.botId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        ...(workspaceDirectory ? { workspaceDirectory, workspaceSkillsPath } : {}),
      },
      error,
    );
  }
}

function resolveWorkspaceDirectory(context: InboundProcessingContext): string | undefined {
  return context.conversation?.state.workingDirectory ?? context.agent?.workspace?.cwd;
}
