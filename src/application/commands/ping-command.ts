import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const pingCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "ping",
    description: "Check bot responsiveness",
    helpDescription: "Check whether the bot is responsive",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "ping";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: `pong\nBot: ${dependencies.runtimeInfo.botId}\nTime: ${message.receivedAt}`,
    };
  },
};
