import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const reloadCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "reload",
    description: "Reload config after this reply",
    helpDescription: "Reload config",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "reload";
  },
  async handle({ message }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "**Reload**",
        "Scheduled.",
      ].join("\n"),
      deliveryAction: "reload",
    };
  },
};
