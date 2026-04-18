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
  const selectedAgentId =
    await conversationStore.getSelectedAgent?.(message.conversation) ??
    defaultAgentId;
  const existing =
    await conversationStore.getActiveForAgent?.(selectedAgentId) ??
    await conversationStore.get(message.conversation);
  if (existing) {
    await logger?.debug("loaded existing conversation", {
      endpointId: message.endpointId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      agentId: existing.state.agentId,
    });
    return existing;
  }

  return createConversationContext(message, selectedAgentId, conversationStore, logger);
}

export async function createConversationContext(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: ConversationStore,
  logger?: Logger,
): Promise<ConversationContext> {
  const createActive = conversationStore.createForAgent ?? conversationStore.create;
  const createdContext = await createActive(message.conversation, {
    agentId: defaultAgentId,
    now: message.receivedAt,
  });
  const createdState: ConversationState = createdContext.state;
  await logger?.debug("created new conversation", {
    endpointId: message.endpointId,
    transport: message.conversation.transport,
    conversationId: message.conversation.externalId,
    messageId: message.messageId,
    correlationId: message.correlationId,
    agentId: defaultAgentId,
  });
  return {
    ...createdContext,
    state: createdState,
  };
}
