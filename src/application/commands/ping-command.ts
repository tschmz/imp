import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const pingCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "ping",
    description: "Check endpoint responsiveness",
    helpDescription: "Check whether the endpoint is responsive",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "ping";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "**Ping**",
        "Status: pong",
        `Endpoint: \`${dependencies.runtimeInfo.endpointId}\``,
        `Time: ${message.receivedAt}`,
      ].join("\n"),
    };
  },
};
