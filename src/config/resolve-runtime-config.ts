import { dirname, join } from "node:path";
import type {
  AgentDelegationConfig,
  AgentMcpConfig,
  AgentMcpServerConfig,
  AgentPhoneCallConfig,
  AgentPromptConfig,
  AgentWorkspaceConfig,
  ModelRef,
  PromptSource,
} from "../domain/agent.js";
import type { DaemonConfig } from "../daemon/types.js";
import { discoverSkills } from "../skills/discovery.js";
import { getTransport } from "../transports/registry.js";
import { filterShadowedPluginAgents, loadRuntimePlugins } from "./plugin-runtime.js";
import { deriveDelegationToolName } from "./schema.js";
import { resolveConfigPath, resolveSecretValue } from "./secret-value.js";
import type { AgentMcpToolsConfig, AgentToolsConfig, AppConfig, ModelConfig } from "./types.js";

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
  const runtimePlugins = await loadRuntimePlugins(appConfig, configDir);
  const effectiveAgents = mergeConfiguredAgents(appConfig.agents, runtimePlugins.agents)
    .map((agent) => resolvePluginToolNameAliases(agent, runtimePlugins.toolNameAliases));
  const mcpServers = resolveGlobalMcpServers(appConfig, configDir, runtimePlugins.mcpServers);

  return {
    configPath,
    logging: {
      level: appConfig.logging?.level ?? "info",
    },
    agents: await Promise.all(
      effectiveAgents.map(async (agent) => {
        const skillPaths = [
          ...(agent.skills?.paths.map((path) => resolveConfigPath(path, configDir)) ?? []),
          ...runtimePlugins.skillPaths,
        ];
        const skillCatalog = await discoverSkills(skillPaths);
        const model = await resolveAgentModel(agent, appConfig.defaults.model, configDir, options);

        return {
          id: agent.id,
          ...(agent.name ? { name: agent.name } : {}),
          prompt: resolveAgentPrompt(agent.prompt, configDir),
          ...(model ? { model } : {}),
          home: resolveAgentHome(agent, appConfig.paths.dataRoot, configDir),
          ...(agent.workspace ? { workspace: resolveAgentWorkspace(agent.workspace, configDir) } : {}),
          ...(agent.skills ? { skills: resolveAgentSkills(agent.skills, configDir) } : {}),
          ...(skillCatalog.skills.length > 0 ? { skillCatalog: skillCatalog.skills } : {}),
          ...(skillCatalog.issues.length > 0 ? { skillIssues: skillCatalog.issues } : {}),
          ...resolveAgentTools(agent, mcpServers, configDir),
        };
      }),
    ),
    commandTools: runtimePlugins.commandTools,
    pluginTools: runtimePlugins.pluginTools,
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

async function resolveAgentModel(
  agent: AppConfig["agents"][number],
  defaultModel: ModelConfig | undefined,
  configDir: string,
  options: ResolveRuntimeConfigOptions,
): Promise<ModelRef | undefined> {
  const model = agent.model ?? defaultModel;
  if (!model) {
    return undefined;
  }

  return resolveModelConfig(model, configDir, options, {
    apiKeyFieldLabel: agent.model ? `agents.${agent.id}.model.apiKey` : "defaults.model.apiKey",
  });
}

async function resolveModelConfig(
  model: ModelConfig,
  configDir: string,
  options: ResolveRuntimeConfigOptions,
  labels: {
    apiKeyFieldLabel: string;
  },
): Promise<ModelRef> {
  const { apiKey, authFile, ...modelConfig } = model;

  return {
    ...modelConfig,
    ...(authFile ? { authFile: resolveConfigPath(authFile, configDir) } : {}),
    ...(apiKey
      ? {
          apiKey: await resolveSecretValue(apiKey, {
            configDir,
            env: options.env,
            readTextFile: options.readTextFile,
            fieldLabel: labels.apiKeyFieldLabel,
          }),
        }
      : {}),
  };
}


function mergeConfiguredAgents(configAgents: AppConfig["agents"], pluginAgents: AppConfig["agents"]): AppConfig["agents"] {
  return [...configAgents, ...filterShadowedPluginAgents(configAgents, pluginAgents)];
}

function resolvePluginToolNameAliases(agent: AppConfig["agents"][number], aliases: Record<string, string>): AppConfig["agents"][number] {
  if (!agent.tools) {
    return agent;
  }
  const agentPluginId = getPluginIdFromNamespacedAgentId(agent.id);
  const resolveToolName = (toolName: string) =>
    aliases[toolName] ?? (agentPluginId ? aliases[`${agentPluginId}.${toolName}`] : undefined) ?? toolName;

  if (Array.isArray(agent.tools)) {
    return {
      ...agent,
      tools: agent.tools.map(resolveToolName),
    };
  }

  return {
    ...agent,
    tools: {
      ...agent.tools,
      ...(agent.tools.builtIn ? { builtIn: agent.tools.builtIn.map(resolveToolName) } : {}),
    },
  };
}

function getPluginIdFromNamespacedAgentId(agentId: string): string | undefined {
  const separatorIndex = agentId.indexOf(".");
  return separatorIndex > 0 ? agentId.slice(0, separatorIndex) : undefined;
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
  agent: AppConfig["agents"][number],
  mcpServers: Map<string, AgentMcpServerConfig>,
  configDir: string,
): Pick<DaemonConfig["agents"][number], "tools" | "delegations" | "mcp" | "phone"> {
  const tools = agent.tools;
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
    ...(tools.agents ? { delegations: resolveAgentDelegations(tools.agents) } : {}),
    ...(tools.mcp ? { mcp: resolveAgentMcpConfig(tools.mcp, mcpServers, agent) } : {}),
    ...(tools.phone ? { phone: resolveAgentPhoneCallConfig(tools.phone, configDir) } : {}),
  };
}

function resolveAgentDelegations(
  delegations: NonNullable<NonNullable<Exclude<AgentToolsConfig, string[]>>["agents"]>,
): AgentDelegationConfig[] {
  return delegations.map((delegation) => ({
    agentId: delegation.agentId,
    toolName: delegation.toolName ?? deriveDelegationToolName(delegation.agentId),
    ...(delegation.description ? { description: delegation.description } : {}),
  }));
}

function resolveGlobalMcpServers(
  appConfig: AppConfig,
  configDir: string,
  pluginMcpServers: AgentMcpServerConfig[] = [],
): Map<string, AgentMcpServerConfig> {
  const globalInheritEnv = appConfig.tools?.mcp?.inheritEnv ?? [];

  return new Map(
    [...(appConfig.tools?.mcp?.servers ?? []), ...pluginMcpServers].map((server) => [
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
  agent: AppConfig["agents"][number],
): AgentMcpConfig {
  return {
    servers: mcp.servers.map((serverId) => {
      const server = mcpServers.get(serverId);
      if (!server) {
        throw new Error(`Unknown MCP server id "${serverId}".`);
      }

      return renderAgentMcpServerTemplates(server, agent);
    }),
  };
}

function renderAgentMcpServerTemplates(
  server: AgentMcpServerConfig,
  agent: AppConfig["agents"][number],
): AgentMcpServerConfig {
  return {
    ...server,
    command: renderAgentTemplate(server.command, agent),
    ...(server.args ? { args: server.args.map((arg) => renderAgentTemplate(arg, agent)) } : {}),
    ...(server.inheritEnv ? { inheritEnv: server.inheritEnv.map((entry) => renderAgentTemplate(entry, agent)) } : {}),
    ...(server.env ? { env: mapRecordValues(server.env, (value) => renderAgentTemplate(value, agent)) } : {}),
    ...(server.cwd ? { cwd: renderAgentTemplate(server.cwd, agent) } : {}),
  };
}

function mapRecordValues(
  record: Record<string, string>,
  mapValue: (value: string) => string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mapValue(value)]));
}

function renderAgentTemplate(value: string, agent: AppConfig["agents"][number]): string {
  return value
    .replaceAll("{{agent.id}}", agent.id)
    .replaceAll("{{agent.name}}", agent.name ?? agent.id);
}

function resolveAgentPhoneCallConfig(
  phone: AgentPhoneCallConfig,
  configDir: string,
): AgentPhoneCallConfig {
  return {
    ...phone,
    ...(phone.requestsDir ? { requestsDir: resolveConfigPath(phone.requestsDir, configDir) } : {}),
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
