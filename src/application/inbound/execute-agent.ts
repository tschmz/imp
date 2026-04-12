import type { InboundProcessingContext } from "./types.js";

export async function executeAgent(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent || !context.conversation) {
    return;
  }

  const result = await context.dependencies.engine.run({
    agent: context.agent,
    conversation: context.conversation,
    message: context.message,
    runtime: {
      configPath: context.dependencies.runtimeInfo.configPath,
      dataRoot: context.dependencies.runtimeInfo.dataRoot,
      ...(context.availableSkills.length > 0 ? { availableSkills: context.availableSkills } : {}),
      ...(context.activatedSkills.length > 0 ? { activatedSkills: context.activatedSkills } : {}),
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
      ...context.conversation.messages,
      toUserConversationMessage(context.message),
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
