import { renderStatusMessage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const statusCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "status",
    description: "Show active session status",
  },
  canHandle(command) {
    return command === "status";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const [conversation, backups] = await Promise.all([
      dependencies.conversationStore.get(message.conversation),
      dependencies.conversationStore.listBackups(message.conversation),
    ]);
    const agent = conversation ? dependencies.agentRegistry.get(conversation.state.agentId) : undefined;

    return {
      conversation: message.conversation,
      text: renderStatusMessage(conversation, backups, agent),
    };
  },
};
