import { getOrCreateConversationContext } from "./conversation-context.js";
import { renderAgentMessage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export const agentCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "agent";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const requestedAgentId = normalizeCommandArgument(message.commandArgs);
    const availableAgentIds = dependencies.agentRegistry.list().map((agent) => agent.id);

    if (!requestedAgentId) {
      const conversation = await dependencies.conversationStore.get(message.conversation);
      const activeAgent =
        dependencies.agentRegistry.get(conversation?.state.agentId ?? dependencies.defaultAgentId) ??
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

    const conversation = await getOrCreateConversationContext(
      message,
      dependencies.defaultAgentId,
      dependencies.conversationStore,
      logger,
    );
    await dependencies.conversationStore.put({
      state: {
        conversation: conversation.state.conversation,
        agentId: requestedAgent.id,
        ...(conversation.state.title ? { title: conversation.state.title } : {}),
        createdAt: conversation.state.createdAt,
        updatedAt: message.receivedAt,
        version: conversation.state.version,
      },
      messages: conversation.messages,
    });

    return {
      conversation: message.conversation,
      text: [
        `Switched the current conversation to agent "${requestedAgent.id}".`,
        "",
        renderAgentMessage(requestedAgent, {
          currentAgentId: requestedAgent.id,
          availableAgentIds,
        }),
      ].join("\n"),
    };
  },
};
