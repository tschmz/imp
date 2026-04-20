import { dirname, join } from "node:path";
import type {
  AgentMcpConfig,
  AgentMcpServerConfig,
  AgentPhoneCallConfig,
  AgentPromptConfig,
  AgentWorkspaceConfig,
  PromptSource,
} from "../domain/agent.js";
import type { DaemonConfig } from "../daemon/types.js";
import { discoverSkills } from "../skills/discovery.js";
import { getTransport } from "../transports/registry.js";
import { resolveConfigPath, resolveSecretValue } from "./secret-value.js";
import type { AgentMcpToolsConfig, AgentToolsConfig, AppConfig } from "./types.js";

interface ResolveRuntimeConfigOptions {
  env?: NodeJS.ProcessEnv;
  includeCliEndpoints?: boolean;
  readTextFile?: (path: string) => Promise<string>;
}

export async function resolveRuntimeConfig(
  appConfig: AppConfig,
  configPath: string,
  options: ResolveRuntimeConfigOptions = {},
): Promise<DaemonConfig> {
  const enabledEndpoints = appConfig.endpoints.filter(
    (endpoint) => endpoint.enabled && (options.includeCliEndpoints || endpoint.type !== "cli"),
  );

  if (enabledEndpoints.length === 0) {
    throw new Error("Config must enable at least one daemon endpoint.");
  }
  const configDir = dirname(configPath);
  const mcpServers = resolveGlobalMcpServers(appConfig, configDir);

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
          home: resolveAgentHome(agent, appConfig.paths.dataRoot, configDir),
          ...(agent.authFile ? { authFile: resolveConfigPath(agent.authFile, configDir) } : {}),
          ...(agent.workspace ? { workspace: resolveAgentWorkspace(agent.workspace, configDir) } : {}),
          ...(agent.skills ? { skills: resolveAgentSkills(agent.skills, configDir) } : {}),
          ...(agent.inference ? { inference: agent.inference } : {}),
          ...(skillCatalog.skills.length > 0 ? { skillCatalog: skillCatalog.skills } : {}),
          ...(skillCatalog.issues.length > 0 ? { skillIssues: skillCatalog.issues } : {}),
          ...resolveAgentTools(agent.tools, mcpServers, configDir),
        };
      }),
    ),
    activeEndpoints: await Promise.all(
      enabledEndpoints.map(async (endpoint) => {
        const transport = getTransport(endpoint.type);
        if (!transport) {
          throw new Error(`Unsupported endpoint type: ${endpoint.type}`);
        }

        const runtimeEndpointConfig = await resolveEndpointRuntimeSecrets(endpoint, configDir, {
          env: options.env,
          readTextFile: options.readTextFile,
        });

        return transport.normalizeRuntimeConfig(
          runtimeEndpointConfig,
          {
            dataRoot: appConfig.paths.dataRoot,
            defaultAgentId: appConfig.defaults.agentId,
          },
        );
      }),
    ),
  };
}

async function resolveEndpointRuntimeSecrets(
  endpoint: AppConfig["endpoints"][number],
  configDir: string,
  options: ResolveRuntimeConfigOptions,
): Promise<AppConfig["endpoints"][number]> {
  if (endpoint.type !== "telegram") {
    return endpoint;
  }

  return {
    ...endpoint,
    token: await resolveSecretValue(endpoint.token, {
      configDir,
      env: options.env,
      readTextFile: options.readTextFile,
      fieldLabel: `endpoints.${endpoint.id}.token`,
    }),
  };
}

function resolveAgentPrompt(prompt: AppConfig["agents"][number]["prompt"], configDir: string): AgentPromptConfig {
  return {
    base: prompt?.base ? resolvePromptSource(prompt.base, configDir) : { builtIn: "default" },
    ...(prompt?.instructions
      ? {
          instructions: prompt.instructions.map((source) => resolvePromptSource(source, configDir)),
        }
      : {}),
    ...(prompt?.references
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

function resolveAgentHome(
  agent: AppConfig["agents"][number],
  dataRoot: string,
  configDir: string,
): string {
  return resolveConfigPath(agent.home ?? join(dataRoot, "agents", agent.id), configDir);
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
  mcpServers: Map<string, AgentMcpServerConfig>,
  configDir: string,
): Pick<DaemonConfig["agents"][number], "tools" | "mcp" | "phone"> {
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
    ...(tools.mcp ? { mcp: resolveAgentMcpConfig(tools.mcp, mcpServers) } : {}),
    ...(tools.phone ? { phone: resolveAgentPhoneCallConfig(tools.phone, configDir) } : {}),
  };
}

function resolveGlobalMcpServers(appConfig: AppConfig, configDir: string): Map<string, AgentMcpServerConfig> {
  const globalInheritEnv = appConfig.tools?.mcp?.inheritEnv ?? [];

  return new Map(
    (appConfig.tools?.mcp?.servers ?? []).map((server) => [
      server.id,
      {
        ...server,
        ...(globalInheritEnv.length > 0 || server.inheritEnv
          ? { inheritEnv: [...globalInheritEnv, ...(server.inheritEnv ?? [])] }
          : {}),
        ...(server.cwd ? { cwd: resolveConfigPath(server.cwd, configDir) } : {}),
      },
    ]),
  );
}

function resolveAgentMcpConfig(
  mcp: AgentMcpToolsConfig,
  mcpServers: Map<string, AgentMcpServerConfig>,
): AgentMcpConfig {
  return {
    servers: mcp.servers.map((serverId) => {
      const server = mcpServers.get(serverId);
      if (!server) {
        throw new Error(`Unknown MCP server id "${serverId}".`);
      }

      return server;
    }),
  };
}

function resolveAgentPhoneCallConfig(
  phone: AgentPhoneCallConfig,
  configDir: string,
): AgentPhoneCallConfig {
  return {
    ...phone,
    ...(phone.cwd ? { cwd: resolveConfigPath(phone.cwd, configDir) } : {}),
    ...(phone.controlDir ? { controlDir: resolveConfigPath(phone.controlDir, configDir) } : {}),
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
