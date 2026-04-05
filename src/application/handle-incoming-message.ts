import type { AgentRegistry } from "../agents/registry.js";
import type { ConversationContext, ConversationState } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { AgentEngine } from "../runtime/types.js";
import type { ConversationStore } from "../storage/types.js";

interface HandleIncomingMessageDependencies {
  agentRegistry: AgentRegistry;
  conversationStore: ConversationStore;
  engine: AgentEngine;
  defaultAgentId: string;
}

export interface HandleIncomingMessage {
  handle(message: IncomingMessage): Promise<OutgoingMessage>;
}

export function createHandleIncomingMessage(
  dependencies: HandleIncomingMessageDependencies,
): HandleIncomingMessage {
  const defaultAgent = dependencies.agentRegistry.get(dependencies.defaultAgentId);

  if (!defaultAgent) {
    throw new Error(`Unknown default agent: ${dependencies.defaultAgentId}`);
  }

  return {
    async handle(message: IncomingMessage): Promise<OutgoingMessage> {
      const conversation = await getOrCreateConversationContext(
        message,
        defaultAgent.id,
        dependencies.conversationStore,
      );
      const agent = dependencies.agentRegistry.get(conversation.state.agentId) ?? defaultAgent;
      const response = await dependencies.engine.run({
        agent,
        conversation,
        message,
      });
      const respondedAt = new Date().toISOString();

      await dependencies.conversationStore.put({
        state: {
          ...conversation.state,
          updatedAt: respondedAt,
        },
        messages: [
          ...conversation.messages,
          toUserConversationMessage(message),
          toAssistantConversationMessage(response.message, message.messageId, respondedAt),
        ],
      });

      return response.message;
    },
  };
}

async function getOrCreateConversationContext(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: ConversationStore,
): Promise<ConversationContext> {
  const existing = await conversationStore.get(message.conversation);
  if (existing) {
    return existing;
  }

  const createdState: ConversationState = {
    conversation: message.conversation,
    agentId: defaultAgentId,
    createdAt: message.receivedAt,
    updatedAt: message.receivedAt,
  };

  const createdContext: ConversationContext = {
    state: createdState,
    messages: [],
  };

  await conversationStore.put(createdContext);
  return createdContext;
}

function toUserConversationMessage(message: IncomingMessage) {
  return {
    id: message.messageId,
    role: "user" as const,
    text: message.text,
    createdAt: message.receivedAt,
  };
}

function toAssistantConversationMessage(
  message: OutgoingMessage,
  parentMessageId: string,
  createdAt: string,
) {
  return {
    id: `${parentMessageId}:assistant`,
    role: "assistant" as const,
    text: message.text,
    createdAt,
  };
}
