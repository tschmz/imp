import type { InboundProcessingContext } from "./types.js";

export async function executeAgent(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent || !context.conversation) {
    return;
  }

  const conversationBeforeRun = context.conversation;
  const userConversationMessage = toUserConversationMessage(context.message);
  let persistedConversation = context.conversation;
  if (context.dependencies.conversationStore.appendEvents) {
    persistedConversation = await context.dependencies.conversationStore.appendEvents(
      persistedConversation,
      [userConversationMessage],
    );
  }

  const result = await context.dependencies.engine.run({
    agent: context.agent,
    conversation: conversationBeforeRun,
    message: context.message,
    onConversationEvents: context.dependencies.conversationStore.appendEvents
      ? async (events) => {
          persistedConversation = await context.dependencies.conversationStore.appendEvents!(
            persistedConversation,
            events,
          );
        }
      : undefined,
    runtime: {
      configPath: context.dependencies.runtimeInfo.configPath,
      dataRoot: context.dependencies.runtimeInfo.dataRoot,
      ...(context.dependencies.runtimeInfo.replyChannel
        ? { replyChannel: context.dependencies.runtimeInfo.replyChannel }
        : {}),
      ...(context.availableSkills.length > 0 ? { availableSkills: context.availableSkills } : {}),
    },
  });

  context.response = result.message;
  context.conversation = {
    state: {
      ...context.conversation.state,
      ...(result.workingDirectory ? { workingDirectory: result.workingDirectory } : {}),
      updatedAt: new Date().toISOString(),
    },
    messages: [
      ...conversationBeforeRun.messages,
      userConversationMessage,
      ...result.conversationEvents,
    ],
  };
}

function toUserConversationMessage(message: InboundProcessingContext["message"]) {
  return {
    kind: "message" as const,
    id: message.messageId,
    role: "user" as const,
    content: message.text,
    timestamp: Date.parse(message.receivedAt),
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
    ...(message.source ? { source: message.source } : {}),
  };
}
