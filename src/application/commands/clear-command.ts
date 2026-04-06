import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const clearCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "clear",
    description: "Clear the active session",
  },
  canHandle(command) {
    return command === "clear";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const existing = await dependencies.conversationStore.get(message.conversation);
    if (!existing) {
      return {
        conversation: message.conversation,
        text: "There is no active session to clear.",
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
      text: "Cleared the active session. The current agent and title were preserved.",
    };
  },
};
