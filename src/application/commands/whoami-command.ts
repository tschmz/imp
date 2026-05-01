import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const whoamiCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "whoami",
    description: "Show endpoint and user IDs",
    helpDescription: "Show your current endpoint, chat, and user IDs",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "whoami";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const conversation = await dependencies.conversationStore.get(message.conversation);
    return {
      conversation: message.conversation,
      text: [
        "**Identity**",
        `Endpoint: \`${dependencies.runtimeInfo.endpointId}\``,
        `Transport: \`${message.conversation.transport}\``,
        `Chat: \`${message.conversation.externalId}\``,
        `User: \`${message.userId}\``,
        `Agent: \`${conversation?.state.agentId ?? dependencies.defaultAgentId}\``,
        `Title: ${conversation?.state.title ?? "not set"}`,
      ].join("\n"),
    };
  },
};
