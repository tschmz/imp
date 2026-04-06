import { renderHistoryMessage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const historyCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "history";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const [conversation, backups] = await Promise.all([
      dependencies.conversationStore.get(message.conversation),
      dependencies.conversationStore.listBackups(message.conversation),
    ]);

    return {
      conversation: message.conversation,
      text: renderHistoryMessage(conversation, backups),
    };
  },
};
