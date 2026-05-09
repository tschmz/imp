import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const whoamiCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "whoami",
    description: "Show endpoint and user IDs",
    helpDescription: "Show endpoint, chat, and user IDs",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "whoami";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "**Identity**",
        `Endpoint: \`${dependencies.runtimeInfo.endpointId}\``,
        `Chat: \`${message.conversation.externalId}\``,
        `User: \`${message.userId}\``,
      ].join("\n"),
    };
  },
};
