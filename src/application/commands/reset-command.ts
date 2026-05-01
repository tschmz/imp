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
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const existing =
      await dependencies.conversationStore.getActiveForAgent?.(agentId) ??
      await dependencies.conversationStore.get(message.conversation);
    if (!existing) {
      return {
        conversation: message.conversation,
        text: ["**Reset**", "No active session to reset."].join("\n"),
      };
    }

    await dependencies.conversationStore.put({
      state: {
        conversation: existing.state.conversation,
        agentId: existing.state.agentId,
        ...(existing.state.title ? { title: existing.state.title } : {}),
        createdAt: existing.state.createdAt,
        updatedAt: message.receivedAt,
        version: existing.state.version,
      },
      messages: [],
    });
    return {
      conversation: message.conversation,
      text: [
        "**Reset**",
        "Messages: 0",
        `Agent: \`${existing.state.agentId}\``,
        `Title: ${existing.state.title ?? "untitled"}`,
      ].join("\n"),
    };
  },
};
