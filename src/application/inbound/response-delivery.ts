import type { ChatRef, ConversationContext } from "../../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../../domain/message.js";
import type { ConversationStore } from "../../storage/types.js";

export function getResponseDeliverySelectionRef(message: IncomingMessage): ChatRef {
  if (isDetachedSessionMessage(message)) {
    return message.conversation;
  }

  return {
    transport: message.conversation.transport,
    externalId: message.conversation.externalId,
    ...(message.conversation.endpointId ? { endpointId: message.conversation.endpointId } : {}),
  };
}

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

function isDetachedSessionMessage(message: IncomingMessage): boolean {
  const session = message.source?.plugin?.metadata?.session;
  return typeof session === "object" && session !== null && "mode" in session && session.mode === "detached";
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
