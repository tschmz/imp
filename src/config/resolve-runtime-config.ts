import { dirname } from "node:path";
import type { AgentPromptConfig, AgentWorkspaceConfig, PromptSource } from "../domain/agent.js";
import type { DaemonConfig } from "../daemon/types.js";
import { normalizeRuntimeBotConfig } from "../transports/registry.js";
import { resolveConfigPath, resolveSecretValue } from "./secret-value.js";
import type { AppConfig } from "./types.js";

interface ResolveRuntimeConfigOptions {
  env?: NodeJS.ProcessEnv;
  readTextFile?: (path: string) => Promise<string>;
}

export async function resolveRuntimeConfig(
  appConfig: AppConfig,
  configPath: string,
  options: ResolveRuntimeConfigOptions = {},
): Promise<DaemonConfig> {
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
      prompt: resolveAgentPrompt(agent.prompt, configDir),
      ...(agent.authFile ? { authFile: resolveConfigPath(agent.authFile, configDir) } : {}),
      ...(agent.workspace ? { workspace: resolveAgentWorkspace(agent.workspace, configDir) } : {}),
    })),
    activeBots: await Promise.all(
      enabledBots.map(async (bot) =>
        normalizeRuntimeBotConfig(
          {
            ...bot,
            token: await resolveSecretValue(bot.token, {
              configDir,
              env: options.env,
              readTextFile: options.readTextFile,
              fieldLabel: `bots.${bot.id}.token`,
            }),
          },
          {
            dataRoot: appConfig.paths.dataRoot,
            defaultAgentId: appConfig.defaults.agentId,
          },
        ),
      ),
    ),
  };
}

function resolveAgentPrompt(prompt: AgentPromptConfig, configDir: string): AgentPromptConfig {
  return {
    base: resolvePromptSource(prompt.base, configDir),
    ...(prompt.instructions
      ? {
          instructions: prompt.instructions.map((source) => resolvePromptSource(source, configDir)),
        }
      : {}),
    ...(prompt.references
      ? {
          references: prompt.references.map((source) => resolvePromptSource(source, configDir)),
        }
      : {}),
  };
}

function resolveAgentWorkspace(workspace: AgentWorkspaceConfig, configDir: string): AgentWorkspaceConfig {
  return {
    ...workspace,
    ...(workspace.cwd ? { cwd: resolveConfigPath(workspace.cwd, configDir) } : {}),
  };
}

function resolvePromptSource(source: PromptSource, configDir: string): PromptSource {
  if (source.file) {
    return {
      file: resolveConfigPath(source.file, configDir),
    };
  }

  return source;
}
