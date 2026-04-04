import type { DaemonConfig } from "../daemon/types.js";

const DEFAULT_DATA_DIR = ".daemon-data";
const DEFAULT_AGENT_ID = "default";

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  return {
    dataDir: env.APP_DATA_DIR ?? DEFAULT_DATA_DIR,
    defaultAgentId: env.DEFAULT_AGENT_ID ?? DEFAULT_AGENT_ID,
    activeBot: {
      id: env.BOT_ID ?? "default-bot",
      type: "telegram",
      token: telegramBotToken,
    },
  };
}
