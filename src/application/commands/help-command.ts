import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const helpCommandHandler: InboundCommandHandler = {
  canHandle(command) {
    return command === "help";
  },
  async handle({ message }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "Available commands:",
        "/help Show this help message.",
        "/new Start a fresh conversation and back up the current one.",
        "/clear Clear the active conversation without creating a backup.",
        "/status Show the current conversation status.",
        "/history List restore points from previous /new resets.",
        "/restore <n> Restore backup number <n> from /history. 1 is the most recent backup.",
        "/whoami Show your current bot, chat, and user IDs.",
        "/rename <title> Set a title for the current conversation.",
        "/export Export the current conversation transcript.",
        "/ping Check whether the bot is responsive.",
        "/config Show runtime and config details for this bot.",
        "/agent Show the current agent details, or switch with /agent <id>.",
        "/logs Show recent daemon log lines for this bot.",
        "/reload Exit after this reply so a supervisor can reload config.",
        "/restart Exit after this reply so a supervisor can restart the daemon.",
      ].join("\n"),
    };
  },
};
