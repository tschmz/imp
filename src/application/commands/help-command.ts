import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const helpCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "help",
    description: "Show available commands",
  },
  canHandle(command) {
    return command === "help";
  },
  async handle({ message }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: [
        "Available commands:",
        "/help Show this help message.",
        "/new Start a fresh session. The previous one stays available in /history.",
        "/clear Clear the active session.",
        "/status Show the active session status.",
        "/history List previous sessions.",
        "/restore <n> Switch to session number <n> from /history. 1 is the most recent previous session.",
        "/whoami Show your current bot, chat, and user IDs.",
        "/rename <title> Set a title for the active session.",
        "/export Export the active session transcript.",
        "/ping Check whether the bot is responsive.",
        "/config Show runtime and config details for this bot.",
        "/agent Show the active agent details, or switch with /agent <id>.",
        "/logs Show recent daemon log lines for this bot.",
        "/reload Exit after this reply so a supervisor can reload config.",
        "/restart Exit after this reply so a supervisor can restart the daemon.",
      ].join("\n"),
    };
  },
};
