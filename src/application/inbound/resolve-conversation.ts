import { getOrCreateConversationContext } from "../commands/conversation-context.js";
import type { InboundProcessingContext } from "./types.js";

export async function resolveConversation(context: InboundProcessingContext): Promise<void> {
  if (context.response) {
    return;
  }

  const conversation = await getOrCreateConversationContext(
    context.message,
    context.defaultAgent.id,
    context.dependencies.conversationStore,
    context.dependencies.logger,
  );

  const agent = context.dependencies.agentRegistry.get(conversation.state.agentId) ?? context.defaultAgent;

  await context.dependencies.logger?.debug("resolved conversation context", {
    botId: context.message.botId,
    transport: context.message.conversation.transport,
    conversationId: context.message.conversation.externalId,
    messageId: context.message.messageId,
    correlationId: context.message.correlationId,
    agentId: agent.id,
  });

  context.conversation = conversation;
  context.agent = agent;
}
