import { renderConversationExport } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const exportCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "export",
    description: "Export the current session transcript",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "export";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const conversation = await dependencies.conversationStore.get(message.conversation);
    if (!conversation) {
      return {
        conversation: message.conversation,
        text: "There is no active session to export.",
      };
    }

    return {
      conversation: message.conversation,
      text: renderConversationExport(conversation),
    };
  },
};
