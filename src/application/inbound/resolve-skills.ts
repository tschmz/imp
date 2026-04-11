import { join } from "node:path";
import { discoverSkills, mergeSkillCatalogs } from "../../skills/discovery.js";
import type { InboundProcessingContext } from "./types.js";

export async function resolveSkills(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent) {
    return;
  }

  const configuredSkillCatalog = context.agent.skillCatalog ?? [];
  const skillSelector = context.dependencies.skillSelector;
  if (!skillSelector) {
    context.activatedSkills = [];
    return;
  }

  const workspaceDirectory = resolveWorkspaceDirectory(context);
  const workspaceSkillsPath = workspaceDirectory ? join(workspaceDirectory, ".skills") : undefined;

  try {
    const workspaceSkillCatalog = workspaceSkillsPath
      ? await discoverSkills([workspaceSkillsPath], { ignoreMissingPaths: true })
      : { skills: [], issues: [] };
    const mergedSkillCatalog = mergeSkillCatalogs(configuredSkillCatalog, workspaceSkillCatalog.skills);
    const skillCatalog = mergedSkillCatalog.skills;

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

    if (skillCatalog.length === 0) {
      context.activatedSkills = [];
      return;
    }

    const activatedSkills = await skillSelector.selectRelevantSkills({
      agent: context.agent,
      userText: context.message.text,
      catalog: skillCatalog,
      maxActivatedSkills: 3,
    });

    const logFields = {
      botId: context.message.botId,
      transport: context.message.conversation.transport,
      conversationId: context.message.conversation.externalId,
      messageId: context.message.messageId,
      correlationId: context.message.correlationId,
      agentId: context.agent.id,
      skillCount: activatedSkills.length,
      skillNames: activatedSkills.map((skill) => skill.name),
      ...(workspaceDirectory ? { workspaceDirectory, workspaceSkillsPath } : {}),
      ...(mergedSkillCatalog.overriddenSkillNames.length > 0
        ? { overriddenSkillNames: mergedSkillCatalog.overriddenSkillNames }
        : {}),
    };

    if (activatedSkills.length > 0) {
      await context.dependencies.logger?.info("resolved agent skills for turn", logFields);
    } else {
      await context.dependencies.logger?.debug("resolved agent skills for turn", logFields);
    }

    context.activatedSkills = activatedSkills;
  } catch (error) {
    void context.dependencies.logger?.error(
      "failed to resolve agent skills for turn; continuing without skill activation",
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
    context.activatedSkills = [];
  }
}

function resolveWorkspaceDirectory(context: InboundProcessingContext): string | undefined {
  return context.conversation?.state.workingDirectory ?? context.agent?.workspace?.cwd;
}
