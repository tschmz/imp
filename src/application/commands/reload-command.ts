import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const reloadCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "reload",
    description: "Reload config after this reply",
    helpDescription: "Exit after this reply so a supervisor can reload config",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "reload";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "**Reload**",
        "Scheduled after this reply.",
        `Config: \`${dependencies.runtimeInfo.configPath}\``,
        "If imp is not running under a service manager yet, start it again manually.",
      ].join("\n"),
      deliveryAction: "reload",
    };
  },
};
