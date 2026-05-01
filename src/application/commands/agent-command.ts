import { renderAgentMessage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export const agentCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "agent",
    description: "Show or change the session agent",
    usage: "/agent [id]",
    helpGroup: "Context",
  },
  canHandle(command) {
    return command === "agent";
  },
  async handle({ message, dependencies, loadAppConfig, logger }: InboundCommandContext) {
    const requestedAgentId = normalizeCommandArgument(message.commandArgs);
    const runtimeAgentIds = dependencies.agentRegistry.list().map((agent) => agent.id);
    const availableAgentIds = await resolveAvailableAgentIds({
      runtimeAgentIds,
      context: { message, dependencies, logger },
      loadAppConfig,
    });

    if (!requestedAgentId) {
      const selectedAgentId =
        await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
        dependencies.defaultAgentId;
      const activeAgent =
        dependencies.agentRegistry.get(selectedAgentId) ??
        dependencies.agentRegistry.get(dependencies.defaultAgentId)!;

      return {
        conversation: {
          ...message.conversation,
          agentId: activeAgent.id,
        },
        text: renderAgentMessage(activeAgent, {
          currentAgentId: activeAgent.id,
          availableAgentIds,
        }),
      };
    }

    const requestedAgent = dependencies.agentRegistry.get(requestedAgentId);
    if (!requestedAgent) {
      const configuredButNotLoaded = availableAgentIds.includes(requestedAgentId);
      const availableAgents = availableAgentIds.map((agentId) => `\`${agentId}\``).join(", ");
      return {
        conversation: message.conversation,
        text: configuredButNotLoaded
          ? [
              "# Agent",
              `Agent \`${requestedAgentId}\` is configured but not loaded in this daemon yet.`,
              "",
              "Use `/reload` so the daemon restarts with the latest plugin agents.",
              `Available agents: ${availableAgents}`,
            ].join("\n")
          : [
              "# Agent",
              `Unknown agent: \`${requestedAgentId}\``,
              `Available agents: ${availableAgents}`,
            ].join("\n"),
      };
    }

    const ensureActive = dependencies.conversationStore.ensureActiveForAgent ?? dependencies.conversationStore.ensureActive;
    await ensureActive(message.conversation, {
      agentId: requestedAgent.id,
      now: message.receivedAt,
    });
    await logger?.debug("selected agent for surface", {
      endpointId: message.endpointId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      agentId: requestedAgent.id,
    });

    return {
      conversation: {
        ...message.conversation,
        agentId: requestedAgent.id,
      },
      text: [
        `Switched this chat to agent \`${requestedAgent.id}\`.`,
        "",
        renderAgentMessage(requestedAgent, {
          currentAgentId: requestedAgent.id,
          availableAgentIds,
        }),
      ].join("\n"),
    };
  },
};


async function resolveAvailableAgentIds(options: {
  runtimeAgentIds: string[];
  context: Pick<InboundCommandContext, "message" | "dependencies" | "logger">;
  loadAppConfig: InboundCommandContext["loadAppConfig"];
}): Promise<string[]> {
  const agentIds = new Set(options.runtimeAgentIds);

  try {
    const appConfig = await options.loadAppConfig(options.context.dependencies.runtimeInfo.configPath);
    const { resolveRuntimeConfig } = await import("../../config/resolve-runtime-config.js");
    const runtimeConfig = await resolveRuntimeConfig(appConfig, options.context.dependencies.runtimeInfo.configPath, {
      includeCliEndpoints: true,
    });
    for (const agent of runtimeConfig.agents) {
      agentIds.add(agent.id);
    }
  } catch (error) {
    await options.context.logger?.debug("failed to resolve configured agents for /agent", {
      endpointId: options.context.message.endpointId,
      conversationId: options.context.message.conversation.externalId,
      messageId: options.context.message.messageId,
      correlationId: options.context.message.correlationId,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return [...agentIds];
}
