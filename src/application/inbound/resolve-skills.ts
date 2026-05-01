import { resolveEffectiveSkills } from "../../skills/resolve-effective-skills.js";
import type { InboundProcessingContext } from "./types.js";

export async function resolveSkills(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent) {
    return;
  }

  try {
    const resolution = await resolveEffectiveSkills({
      agent: context.agent,
      dataRoot: context.dependencies.runtimeInfo.dataRoot,
      conversation: context.conversation,
    });

    context.availableSkills = resolution.skills;

    for (const issue of resolution.issues) {
      await context.dependencies.logger?.info(issue, {
        endpointId: context.message.endpointId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        ...(resolution.globalSkillsPath ? { globalSkillsPath: resolution.globalSkillsPath } : {}),
        ...(resolution.userSharedSkillsPath ? { userSharedSkillsPath: resolution.userSharedSkillsPath } : {}),
        ...(resolution.agentHomeSkillsPath ? { agentHomeSkillsPath: resolution.agentHomeSkillsPath } : {}),
        ...(resolution.workspaceDirectory ? { workspaceDirectory: resolution.workspaceDirectory } : {}),
        ...(resolution.workspaceAgentSkillsPath ? { workspaceAgentSkillsPath: resolution.workspaceAgentSkillsPath } : {}),
      });
    }

    if (resolution.overriddenSkillNames.length > 0) {
      await context.dependencies.logger?.info("auto-discovered skills override earlier agent skills for turn", {
        endpointId: context.message.endpointId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
        ...(resolution.globalSkillsPath ? { globalSkillsPath: resolution.globalSkillsPath } : {}),
        ...(resolution.userSharedSkillsPath ? { userSharedSkillsPath: resolution.userSharedSkillsPath } : {}),
        ...(resolution.agentHomeSkillsPath ? { agentHomeSkillsPath: resolution.agentHomeSkillsPath } : {}),
        ...(resolution.workspaceDirectory ? { workspaceDirectory: resolution.workspaceDirectory } : {}),
        ...(resolution.workspaceAgentSkillsPath ? { workspaceAgentSkillsPath: resolution.workspaceAgentSkillsPath } : {}),
        overriddenSkillNames: resolution.overriddenSkillNames,
      });
    }

    await context.dependencies.logger?.debug("resolved effective agent skills for turn", {
      event: "agent.skills.resolved",
      component: "agent-runtime",
      endpointId: context.message.endpointId,
      transport: context.message.conversation.transport,
      conversationId: context.message.conversation.externalId,
      messageId: context.message.messageId,
      correlationId: context.message.correlationId,
      agentId: context.agent.id,
      skillNames: resolution.skills.map((skill) => skill.name),
      ...(resolution.globalSkillsPath ? { globalSkillsPath: resolution.globalSkillsPath } : {}),
      ...(resolution.userSharedSkillsPath ? { userSharedSkillsPath: resolution.userSharedSkillsPath } : {}),
      ...(resolution.agentHomeSkillsPath ? { agentHomeSkillsPath: resolution.agentHomeSkillsPath } : {}),
      ...(resolution.workspaceDirectory ? { workspaceDirectory: resolution.workspaceDirectory } : {}),
      ...(resolution.workspaceAgentSkillsPath ? { workspaceAgentSkillsPath: resolution.workspaceAgentSkillsPath } : {}),
      ...(resolution.overriddenSkillNames.length > 0
        ? { overriddenSkillNames: resolution.overriddenSkillNames }
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
      },
      error,
    );
  }
}
