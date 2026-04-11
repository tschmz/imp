import { dirname } from "node:path";
import type {
  AgentMcpConfig,
  AgentPromptConfig,
  AgentWorkspaceConfig,
  PromptSource,
} from "../domain/agent.js";
import type { DaemonConfig } from "../daemon/types.js";
import { discoverSkills } from "../skills/discovery.js";
import { getTransport } from "../transports/registry.js";
import { resolveConfigPath, resolveSecretValue } from "./secret-value.js";
import type { SecretValueConfig } from "./secret-value.js";
import type { AgentToolsConfig, AppConfig } from "./types.js";

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
    agents: await Promise.all(
      appConfig.agents.map(async (agent) => {
        const skillPaths = agent.skills?.paths.map((path) => resolveConfigPath(path, configDir)) ?? [];
        const skillCatalog = await discoverSkills(skillPaths);

        return {
          id: agent.id,
          ...(agent.name ? { name: agent.name } : {}),
          prompt: resolveAgentPrompt(agent.prompt, configDir),
          ...(agent.model ? { model: agent.model } : {}),
          ...(agent.authFile ? { authFile: resolveConfigPath(agent.authFile, configDir) } : {}),
          ...(agent.workspace ? { workspace: resolveAgentWorkspace(agent.workspace, configDir) } : {}),
          ...(agent.skills ? { skills: resolveAgentSkills(agent.skills, configDir) } : {}),
          ...(agent.inference ? { inference: agent.inference } : {}),
          ...(skillCatalog.skills.length > 0 ? { skillCatalog: skillCatalog.skills } : {}),
          ...(skillCatalog.issues.length > 0 ? { skillIssues: skillCatalog.issues } : {}),
          ...resolveAgentTools(agent.tools, configDir),
        };
      }),
    ),
    activeBots: await Promise.all(
      enabledBots.map(async (bot) => {
        const transport = getTransport(bot.type);
        if (!transport) {
          throw new Error(`Unsupported bot type: ${bot.type}`);
        }

        const runtimeBotConfig = await resolveBotRuntimeSecrets(bot, configDir, {
          env: options.env,
          readTextFile: options.readTextFile,
        });

        return transport.normalizeRuntimeConfig(
          runtimeBotConfig,
          {
            dataRoot: appConfig.paths.dataRoot,
            defaultAgentId: appConfig.defaults.agentId,
          },
        );
      }),
    ),
  };
}

async function resolveBotRuntimeSecrets(
  bot: AppConfig["bots"][number],
  configDir: string,
  options: ResolveRuntimeConfigOptions,
): Promise<AppConfig["bots"][number]> {
  if (!hasTokenSecret(bot)) {
    return bot;
  }

  return {
    ...bot,
    token: await resolveSecretValue(bot.token, {
      configDir,
      env: options.env,
      readTextFile: options.readTextFile,
      fieldLabel: `bots.${bot.id}.token`,
    }),
  };
}

function hasTokenSecret(bot: AppConfig["bots"][number]): bot is AppConfig["bots"][number] & { token: SecretValueConfig } {
  return Object.hasOwn(bot, "token") && (bot as { token?: unknown }).token !== undefined;
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

function resolveAgentSkills(
  skills: NonNullable<AppConfig["agents"][number]["skills"]>,
  configDir: string,
): NonNullable<AppConfig["agents"][number]["skills"]> {
  return {
    paths: skills.paths.map((path) => resolveConfigPath(path, configDir)),
  };
}

function resolveAgentTools(
  tools: AgentToolsConfig | undefined,
  configDir: string,
): Pick<DaemonConfig["agents"][number], "tools" | "mcp"> {
  if (!tools) {
    return {};
  }

  if (Array.isArray(tools)) {
    return {
      tools,
    };
  }

  return {
    ...(tools.builtIn ? { tools: tools.builtIn } : {}),
    ...(tools.mcp ? { mcp: resolveAgentMcpConfig(tools.mcp, configDir) } : {}),
  };
}

function resolveAgentMcpConfig(mcp: AgentMcpConfig, configDir: string): AgentMcpConfig {
  return {
    servers: mcp.servers.map((server) => ({
      ...server,
      ...(server.cwd ? { cwd: resolveConfigPath(server.cwd, configDir) } : {}),
    })),
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
