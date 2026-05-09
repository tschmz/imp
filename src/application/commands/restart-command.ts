import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const restartCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "restart",
    description: "Restart after this reply",
    helpDescription: "Restart daemon",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "restart";
  },
  async handle({ message }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "**Restart**",
        "Scheduled.",
      ].join("\n"),
      deliveryAction: "restart",
    };
  },
};
