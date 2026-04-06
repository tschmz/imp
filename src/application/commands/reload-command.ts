import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const reloadCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "reload";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "Reload scheduled.",
        `The daemon will exit after this reply so a supervisor can restart it and reload ${dependencies.runtimeInfo.configPath}.`,
        "If imp is not running under a service manager yet, start it again manually.",
      ].join("\n"),
      deliveryAction: "reload",
    };
  },
};
