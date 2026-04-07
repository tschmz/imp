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
        "",
        "Sessions:",
        "/help Show this help message.",
        "/new [title] Start a new session. The previous one stays available in /history.",
        "/rename <title> Rename the current session.",
        "/status Show the current session.",
        "/history Show recent sessions.",
        "/restore <n> Restore a session from /history. 1 is the most recent previous session.",
        "/reset Reset messages in the current session while preserving its title and agent.",
        "/export Export the current session transcript.",
        "",
        "Context:",
        "/agent Show or change the session agent.",
        "",
        "Diagnostics:",
        "/ping Check whether the bot is responsive.",
        "/whoami Show your current bot, chat, and user IDs.",
        "/config Show runtime and config details for this bot.",
        "/logs Show recent daemon log lines for this bot.",
        "/reload Exit after this reply so a supervisor can reload config.",
        "/restart Exit after this reply so a supervisor can restart the daemon.",
      ].join("\n"),
    };
  },
};
