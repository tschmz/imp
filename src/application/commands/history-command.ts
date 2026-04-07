import { renderHistoryMessage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const historyCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "history",
    description: "Show recent sessions",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "history";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const [conversation, backups] = await Promise.all([
      dependencies.conversationStore.get(message.conversation),
      dependencies.conversationStore.listBackups(message.conversation),
    ]);
    const agent = conversation ? dependencies.agentRegistry.get(conversation.state.agentId) : undefined;

    return {
      conversation: message.conversation,
      text: renderHistoryMessage(conversation, backups, agent),
    };
  },
};
