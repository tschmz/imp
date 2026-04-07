import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const restartCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "restart",
    description: "Restart after this reply",
    helpDescription: "Exit after this reply so a supervisor can restart the daemon",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "restart";
  },
  async handle({ message }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "Restart scheduled.",
        "The daemon will exit after this reply so a supervisor can restart it.",
        "If imp is not running under a service manager yet, start it again manually.",
      ].join("\n"),
      deliveryAction: "restart",
    };
  },
};
