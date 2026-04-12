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
      text: `pong\nEndpoint: ${dependencies.runtimeInfo.endpointId}\nTime: ${message.receivedAt}`,
    };
  },
};
