import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const whoamiCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "whoami";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const conversation = await dependencies.conversationStore.get(message.conversation);
    return {
      conversation: message.conversation,
      text: [
        "Identity:",
        `Bot: ${dependencies.runtimeInfo.botId}`,
        `Transport: ${message.conversation.transport}`,
        `Chat ID: ${message.conversation.externalId}`,
        `User ID: ${message.userId}`,
        `Current agent: ${conversation?.state.agentId ?? dependencies.defaultAgentId}`,
        `Title: ${conversation?.state.title ?? "not set"}`,
      ].join("\n"),
    };
  },
};
