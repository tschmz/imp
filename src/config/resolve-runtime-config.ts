import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentContextConfig } from "../domain/agent.js";
import type { DaemonConfig } from "../daemon/types.js";
import { normalizeRuntimeBotConfig } from "../transports/registry.js";
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
    activeBots: enabledBots.map((bot) =>
      normalizeRuntimeBotConfig(bot, {
        dataRoot: appConfig.paths.dataRoot,
        defaultAgentId: appConfig.defaults.agentId,
      }),
    ),
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
