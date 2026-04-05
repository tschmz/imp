import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AgentContextConfig } from "../domain/agent.js";
import type { DaemonConfig } from "../daemon/types.js";
import type { AppConfig } from "./types.js";

export function resolveRuntimeConfig(appConfig: AppConfig, configPath: string): DaemonConfig {
  const enabledBots = appConfig.bots.filter((bot) => bot.enabled);

  if (enabledBots.length === 0) {
    throw new Error("Config must enable at least one bot.");
  }
  const configDir = dirname(configPath);

  return {
    configPath,
    logging: {
      level: appConfig.logging?.level ?? "info",
    },
    agents: appConfig.agents.map((agent) => ({
      ...agent,
      ...(agent.systemPromptFile
        ? { systemPromptFile: resolveConfigPath(agent.systemPromptFile, configDir) }
        : {}),
      ...(agent.authFile ? { authFile: resolveConfigPath(agent.authFile, configDir) } : {}),
      ...(agent.context ? { context: resolveAgentContext(agent.context, configDir) } : {}),
    })),
    activeBots: enabledBots.map((bot) => {
      if (bot.type !== "telegram") {
        throw new Error(`Unsupported bot type: ${bot.type}`);
      }

      const botRoot = join(appConfig.paths.dataRoot, "bots", bot.id);

      return {
        id: bot.id,
        type: bot.type,
        token: bot.token,
        allowedUserIds: bot.access.allowedUserIds,
        defaultAgentId: bot.routing?.defaultAgentId ?? appConfig.defaults.agentId,
        paths: {
          dataRoot: appConfig.paths.dataRoot,
          botRoot,
          conversationsDir: join(botRoot, "conversations"),
          logsDir: join(botRoot, "logs"),
          logFilePath: join(botRoot, "logs", "daemon.log"),
          runtimeDir: join(botRoot, "runtime"),
          runtimeStatePath: join(botRoot, "runtime", "daemon.json"),
        },
      };
    }),
  };
}

function resolveConfigPath(path: string, configDir: string): string {
  return isAbsolute(path) ? path : resolve(configDir, path);
}

function resolveAgentContext(context: AgentContextConfig, configDir: string): AgentContextConfig {
  return {
    ...context,
    ...(context.workingDirectory
      ? {
          workingDirectory: resolveConfigPath(context.workingDirectory, configDir),
        }
      : {}),
    ...(context.files
      ? {
          files: context.files.map((path) => resolveConfigPath(path, configDir)),
        }
      : {}),
  };
}
