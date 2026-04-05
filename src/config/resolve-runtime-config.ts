import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AgentContextConfig } from "../domain/agent.js";
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
  const configDir = dirname(configPath);

  return {
    paths: {
      dataRoot: appConfig.paths.dataRoot,
      botRoot,
      conversationsDir: join(botRoot, "conversations"),
      logsDir: join(botRoot, "logs"),
      logFilePath: join(botRoot, "logs", "daemon.log"),
      runtimeDir: join(botRoot, "runtime"),
      runtimeStatePath: join(botRoot, "runtime", "daemon.json"),
    },
    configPath,
    defaultAgentId: bot.routing?.defaultAgentId ?? appConfig.defaults.agentId,
    agents: appConfig.agents.map((agent) => ({
      ...agent,
      ...(agent.context ? { context: resolveAgentContext(agent.context, configDir) } : {}),
    })),
    activeBot: {
      id: bot.id,
      type: bot.type,
      token: bot.token,
      allowedUserIds: bot.access.allowedUserIds,
    },
  };
}

function resolveAgentContext(context: AgentContextConfig, configDir: string): AgentContextConfig {
  return {
    ...context,
    ...(context.workingDirectory
      ? {
          workingDirectory: isAbsolute(context.workingDirectory)
            ? context.workingDirectory
            : resolve(configDir, context.workingDirectory),
        }
      : {}),
    ...(context.files
      ? {
          files: context.files.map((path) =>
            isAbsolute(path) ? path : resolve(configDir, path),
          ),
        }
      : {}),
  };
}
