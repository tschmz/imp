import type { AgentRegistry } from "../agents/registry.js";
import type { ConversationContext, ConversationState } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import type { AgentEngine } from "../runtime/types.js";
import type { ConversationStore } from "../storage/types.js";

interface HandleIncomingMessageDependencies {
  agentRegistry: AgentRegistry;
  conversationStore: ConversationStore;
  engine: AgentEngine;
  defaultAgentId: string;
  logger?: Logger;
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
      if (message.command === "new") {
        await dependencies.conversationStore.reset(message.conversation);
        await createConversationContext(
          message,
          defaultAgent.id,
          dependencies.conversationStore,
          dependencies.logger,
        );
        await dependencies.logger?.debug("reset conversation via inbound command", {
          botId: message.botId,
          transport: message.conversation.transport,
          conversationId: message.conversation.externalId,
          messageId: message.messageId,
          correlationId: message.correlationId,
          command: message.command,
          agentId: defaultAgent.id,
        });
        return {
          conversation: message.conversation,
          text: "Started a fresh conversation. The previous conversation was backed up.",
        };
      }

      const conversation = await getOrCreateConversationContext(
        message,
        defaultAgent.id,
        dependencies.conversationStore,
        dependencies.logger,
      );
      const agent = dependencies.agentRegistry.get(conversation.state.agentId) ?? defaultAgent;
      await dependencies.logger?.debug("resolved conversation context", {
        botId: message.botId,
        transport: message.conversation.transport,
        conversationId: message.conversation.externalId,
        messageId: message.messageId,
        correlationId: message.correlationId,
        agentId: agent.id,
      });
      const response = await dependencies.engine.run({
        agent,
        conversation,
        message,
      });
      const respondedAt = new Date().toISOString();

      await dependencies.conversationStore.put({
        state: {
          ...conversation.state,
          ...(response.workingDirectory ? { workingDirectory: response.workingDirectory } : {}),
          updatedAt: respondedAt,
        },
        messages: [
          ...conversation.messages,
          toUserConversationMessage(message),
          toAssistantConversationMessage(
            response.message,
            message.messageId,
            respondedAt,
            message.correlationId,
          ),
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

async function createConversationContext(
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

function toUserConversationMessage(message: IncomingMessage) {
  return {
    id: message.messageId,
    role: "user" as const,
    text: message.text,
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
  };
}

function toAssistantConversationMessage(
  message: OutgoingMessage,
  parentMessageId: string,
  createdAt: string,
  correlationId: string,
) {
  return {
    id: `${parentMessageId}:assistant`,
    role: "assistant" as const,
    text: message.text,
    createdAt,
    correlationId,
  };
}
