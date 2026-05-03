import type { ChatRef, ConversationContext } from "../../domain/conversation.js";
import type { OutgoingMessage } from "../../domain/message.js";
import type { ConversationStore } from "../../storage/types.js";

export async function isConversationStillSelected(
  store: ConversationStore,
  ref: ChatRef,
  conversation: ConversationContext,
  defaultAgentId: string,
): Promise<boolean> {
  if (!store.getSelectedAgent || !store.getActiveForAgent) {
    return true;
  }

  const agentId = conversation.state.agentId;
  const selectedAgentId = await store.getSelectedAgent(ref) ?? defaultAgentId;
  if (selectedAgentId !== agentId) {
    return false;
  }

  if (ref.sessionId) {
    return ref.sessionId === conversation.state.conversation.sessionId;
  }

  const activeConversation = await store.getActiveForAgent(agentId);
  const activeSessionId = activeConversation?.state.conversation.sessionId;
  const runSessionId = conversation.state.conversation.sessionId;
  return Boolean(activeSessionId && runSessionId && activeSessionId === runSessionId);
}

export async function markResponseSuppressedWhenStale<TMessage extends OutgoingMessage>(
  message: TMessage,
  options: {
    store: ConversationStore;
    ref: ChatRef;
    conversation: ConversationContext;
    defaultAgentId: string;
  },
): Promise<TMessage> {
  const stillSelected = await isConversationStillSelected(
    options.store,
    options.ref,
    options.conversation,
    options.defaultAgentId,
  );

  return stillSelected ? message : { ...message, suppressDelivery: true };
}
