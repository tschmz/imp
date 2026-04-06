import { renderConversationExport } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const exportCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "export";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const conversation = await dependencies.conversationStore.get(message.conversation);
    if (!conversation) {
      return {
        conversation: message.conversation,
        text: "There is no active conversation to export.",
      };
    }

    return {
      conversation: message.conversation,
      text: renderConversationExport(conversation),
    };
  },
};
