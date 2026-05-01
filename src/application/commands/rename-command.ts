import { getOrCreateConversationContext } from "./conversation-context.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export const renameCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "rename",
    description: "Rename the current session",
    usage: "/rename <title>",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "rename";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const title = normalizeCommandArgument(message.commandArgs);
    if (!title) {
      return {
        conversation: message.conversation,
        text: ["**Rename**", "Usage: `/rename <title>`"].join("\n"),
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
      text: ["**Rename**", `Title: ${title}`].join("\n"),
    };
  },
};
