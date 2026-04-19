import { join } from "node:path";
import { discoverSkills, mergeSkillCatalogs } from "../../skills/discovery.js";
import type { InboundProcessingContext } from "./types.js";

export async function resolveSkills(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent) {
    return;
  }

  const configuredSkillCatalog = context.agent.skillCatalog ?? [];
  const globalSkillsPath = join(context.dependencies.runtimeInfo.dataRoot, "skills");
  const agentHomeSkillsPath = context.agent.home ? join(context.agent.home, ".skills") : undefined;
  const workspaceDirectory = resolveWorkspaceDirectory(context);
  const workspaceSkillsPath = workspaceDirectory ? join(workspaceDirectory, ".skills") : undefined;

  try {
    const globalSkillCatalog = await discoverSkills([globalSkillsPath], { ignoreMissingPaths: true });
    const agentHomeSkillCatalog = agentHomeSkillsPath
      ? await discoverSkills([agentHomeSkillsPath], { ignoreMissingPaths: true })
      : { skills: [], issues: [] };
    const workspaceSkillCatalog = workspaceSkillsPath
      ? await discoverSkills([workspaceSkillsPath], { ignoreMissingPaths: true })
      : { skills: [], issues: [] };
    const agentHomeMergedSkillCatalog = mergeSkillCatalogs(globalSkillCatalog.skills, agentHomeSkillCatalog.skills);
    const configuredMergedSkillCatalog = mergeSkillCatalogs(
      agentHomeMergedSkillCatalog.skills,
      configuredSkillCatalog,
    );
    const mergedSkillCatalog = mergeSkillCatalogs(configuredMergedSkillCatalog.skills, workspaceSkillCatalog.skills);
    const skillCatalog = mergedSkillCatalog.skills;

    context.availableSkills = skillCatalog;

    for (const issue of [
      ...globalSkillCatalog.issues,
      ...agentHomeSkillCatalog.issues,
      ...workspaceSkillCatalog.issues,
    ]) {
      await context.dependencies.logger?.info(issue, {
        endpointId: context.message.endpointId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        globalSkillsPath,
        agentHomeSkillsPath,
        workspaceDirectory,
        workspaceSkillsPath,
      });
    }

    const overriddenSkillNames = [
      ...new Set([
        ...configuredMergedSkillCatalog.overriddenSkillNames,
        ...agentHomeMergedSkillCatalog.overriddenSkillNames,
        ...mergedSkillCatalog.overriddenSkillNames,
      ]),
    ].sort((left, right) => left.localeCompare(right));

    if (overriddenSkillNames.length > 0) {
      await context.dependencies.logger?.info("auto-discovered skills override earlier agent skills for turn", {
        endpointId: context.message.endpointId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        globalSkillsPath,
        agentHomeSkillsPath,
        workspaceDirectory,
        workspaceSkillsPath,
        overriddenSkillNames,
      });
    }

    await context.dependencies.logger?.debug("resolved effective agent skills for turn", {
      endpointId: context.message.endpointId,
      transport: context.message.conversation.transport,
      conversationId: context.message.conversation.externalId,
      messageId: context.message.messageId,
      correlationId: context.message.correlationId,
      agentId: context.agent.id,
      skillCount: skillCatalog.length,
      skillNames: skillCatalog.map((skill) => skill.name),
      globalSkillsPath,
      ...(agentHomeSkillsPath ? { agentHomeSkillsPath } : {}),
      ...(workspaceDirectory ? { workspaceDirectory, workspaceSkillsPath } : {}),
      ...(overriddenSkillNames.length > 0
        ? { overriddenSkillNames }
        : {}),
    });

  } catch (error) {
    context.availableSkills = [];
    void context.dependencies.logger?.error(
      "failed to resolve effective agent skills for turn; continuing without skills",
      {
        endpointId: context.message.endpointId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        globalSkillsPath,
        ...(agentHomeSkillsPath ? { agentHomeSkillsPath } : {}),
        ...(workspaceDirectory ? { workspaceDirectory, workspaceSkillsPath } : {}),
      },
      error,
    );
  }
}

function resolveWorkspaceDirectory(context: InboundProcessingContext): string | undefined {
  return context.conversation?.state.workingDirectory ?? context.agent?.workspace?.cwd;
}
