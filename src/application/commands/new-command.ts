import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const newCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "new",
    description: "Start a fresh session",
  },
  canHandle(command) {
    return command === "new";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    await dependencies.conversationStore.create(message.conversation, {
      agentId: dependencies.defaultAgentId,
      now: message.receivedAt,
    });
    await logger?.debug("reset conversation via inbound command", {
      botId: message.botId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      command: message.command,
      agentId: dependencies.defaultAgentId,
    });

    return {
      conversation: message.conversation,
      text: "Started a fresh session. Your previous session is still available in /history.",
    };
  },
};
