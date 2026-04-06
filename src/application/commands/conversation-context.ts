import type { ConversationContext, ConversationState } from "../../domain/conversation.js";
import type { IncomingMessage } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import type { ConversationStore } from "../../storage/types.js";

export async function getOrCreateConversationContext(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: ConversationStore,
  logger?: Logger,
): Promise<ConversationContext> {
  const existing = await conversationStore.get(message.conversation);
  if (existing) {
    await logger?.debug("loaded existing conversation", {
      botId: message.botId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      agentId: existing.state.agentId,
    });
    return existing;
  }

  return createConversationContext(message, defaultAgentId, conversationStore, logger);
}

export async function createConversationContext(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: ConversationStore,
  logger?: Logger,
): Promise<ConversationContext> {
  const createdState: ConversationState = {
    conversation: message.conversation,
    agentId: defaultAgentId,
    createdAt: message.receivedAt,
    updatedAt: message.receivedAt,
    version: 0,
  };

  const createdContext: ConversationContext = {
    state: createdState,
    messages: [],
  };

  await conversationStore.put(createdContext);
  await logger?.debug("created new conversation", {
    botId: message.botId,
    transport: message.conversation.transport,
    conversationId: message.conversation.externalId,
    messageId: message.messageId,
    correlationId: message.correlationId,
    agentId: defaultAgentId,
  });
  return {
    ...createdContext,
    state: {
      ...createdState,
      version: 1,
    },
  };
}
