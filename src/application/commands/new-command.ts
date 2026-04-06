import { createConversationContext } from "./conversation-context.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const newCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "new";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    await dependencies.conversationStore.reset(message.conversation);
    await createConversationContext(
      message,
      dependencies.defaultAgentId,
      dependencies.conversationStore,
      logger,
    );
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
      text: "Started a fresh conversation. The previous conversation was backed up.",
    };
  },
};
