import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const resetCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "reset",
    description: "Reset messages in the current session",
    helpDescription: "Reset messages in the current session while preserving its title and agent",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "reset";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const existing = await dependencies.conversationStore.get(message.conversation);
    if (!existing) {
      return {
        conversation: message.conversation,
        text: "There is no active session whose messages can be reset.",
      };
    }

    await dependencies.conversationStore.put({
      state: {
        conversation: existing.state.conversation,
        agentId: existing.state.agentId,
        ...(existing.state.title ? { title: existing.state.title } : {}),
        createdAt: message.receivedAt,
        updatedAt: message.receivedAt,
        version: existing.state.version,
      },
      messages: [],
    });
    return {
      conversation: message.conversation,
      text: "Reset the messages in the current session. The current agent and title were preserved.",
    };
  },
};
