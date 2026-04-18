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
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const requestedAgentId = normalizeCommandArgument(message.commandArgs);
    const availableAgentIds = dependencies.agentRegistry.list().map((agent) => agent.id);

    if (!requestedAgentId) {
      const selectedAgentId =
        await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
        dependencies.defaultAgentId;
      const activeAgent =
        dependencies.agentRegistry.get(selectedAgentId) ??
        dependencies.agentRegistry.get(dependencies.defaultAgentId)!;

      return {
        conversation: message.conversation,
        text: renderAgentMessage(activeAgent, {
          currentAgentId: activeAgent.id,
          availableAgentIds,
        }),
      };
    }

    const requestedAgent = dependencies.agentRegistry.get(requestedAgentId);
    if (!requestedAgent) {
      return {
        conversation: message.conversation,
        text: [`Unknown agent: ${requestedAgentId}`, `Available: ${availableAgentIds.join(", ")}`].join(
          "\n",
        ),
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
      conversation: message.conversation,
      text: [
        `Switched this chat to agent "${requestedAgent.id}".`,
        "",
        renderAgentMessage(requestedAgent, {
          currentAgentId: requestedAgent.id,
          availableAgentIds,
        }),
      ].join("\n"),
    };
  },
};
