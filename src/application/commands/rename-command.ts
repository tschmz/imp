import { getOrCreateConversationContext } from "./conversation-context.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export const renameCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "rename";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const title = normalizeCommandArgument(message.commandArgs);
    if (!title) {
      return {
        conversation: message.conversation,
        text: "Usage: /rename <title>",
      };
    }

    const conversation = await getOrCreateConversationContext(
      message,
      dependencies.defaultAgentId,
      dependencies.conversationStore,
      logger,
    );
    await dependencies.conversationStore.put({
      state: {
        ...conversation.state,
        title,
        updatedAt: message.receivedAt,
      },
      messages: conversation.messages,
    });
    return {
      conversation: message.conversation,
      text: `Renamed the current conversation to "${title}".`,
    };
  },
};
