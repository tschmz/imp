import { join } from "node:path";
import type { DaemonConfig } from "../daemon/types.js";
import type { AppConfig } from "./types.js";

export function resolveRuntimeConfig(appConfig: AppConfig, configPath: string): DaemonConfig {
  const enabledBots = appConfig.bots.filter((bot) => bot.enabled);

  if (enabledBots.length === 0) {
    throw new Error("Config must enable at least one bot.");
  }

  if (enabledBots.length > 1) {
    throw new Error(
      "Current runtime supports only one enabled bot. " +
        "Keep the config in multi-bot format, but enable exactly one bot for now.",
    );
  }

  const bot = enabledBots[0];
  if (bot.type !== "telegram") {
    throw new Error(`Unsupported bot type: ${bot.type}`);
  }

  const botRoot = join(appConfig.paths.dataRoot, "bots", bot.id);

  return {
    paths: {
      dataRoot: appConfig.paths.dataRoot,
      botRoot,
      conversationsDir: join(botRoot, "conversations"),
      logsDir: join(botRoot, "logs"),
      logFilePath: join(botRoot, "logs", "daemon.log"),
      runtimeDir: join(botRoot, "runtime"),
    },
    configPath,
    defaultAgentId: bot.routing?.defaultAgentId ?? appConfig.defaults.agentId,
    activeBot: {
      id: bot.id,
      type: bot.type,
      token: bot.token,
    },
  };
}
