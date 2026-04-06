import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const pingCommandHandler: InboundCommandHandler = {
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
