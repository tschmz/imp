import { dirname, join } from "node:path";
import type {
  AgentDelegationConfig,
  AgentMcpConfig,
  AgentMcpServerConfig,
  AgentMcpToolFilter,
  AgentPhoneCallConfig,
  AgentPromptConfig,
  AgentWorkspaceConfig,
  ModelRef,
  PromptSource,
} from "../domain/agent.js";
import type { DaemonConfig } from "../daemon/types.js";
import { discoverSkills } from "../skills/discovery.js";
import { getTransport } from "../transports/registry.js";
import { DEFAULT_LOG_ROTATION_SIZE } from "../logging/file-logger.js";
import { filterShadowedPluginAgents, loadRuntimePlugins } from "./plugin-runtime.js";
import { deriveDelegationToolName } from "./schema.js";
import { resolveConfigPath, resolveSecretValue, type SecretValueConfig } from "./secret-value.js";
import type { AgentMcpToolsConfig, AgentToolsConfig, AppConfig, McpServerConfig, ModelConfig } from "./types.js";

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
      rotationSize: appConfig.logging?.rotationSize ?? DEFAULT_LOG_ROTATION_SIZE,
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
          ...(await resolveAgentTools(agent, mcpServers, configDir, options)),
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

async function resolveAgentTools(
  agent: AppConfig["agents"][number],
  mcpServers: Map<string, McpServerConfig>,
  configDir: string,
  options: ResolveRuntimeConfigOptions,
): Promise<Pick<DaemonConfig["agents"][number], "tools" | "delegations" | "mcp" | "phone">> {
  const tools = agent.tools;
  if (!tools) {
    return {};
  }

  if (Array.isArray(tools)) {
    return {
      tools,
    };
  }

  const mcp = tools.mcp
    ? await resolveAgentMcpConfig(tools.mcp, mcpServers, agent, configDir, options)
    : undefined;

  return {
    ...(tools.builtIn ? { tools: tools.builtIn } : {}),
    ...(tools.agents ? { delegations: resolveAgentDelegations(tools.agents) } : {}),
    ...(mcp ? { mcp } : {}),
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
  pluginMcpServers: McpServerConfig[] = [],
): Map<string, McpServerConfig> {
  const globalInheritEnv = appConfig.tools?.mcp?.inheritEnv ?? [];

  return new Map(
    [...(appConfig.tools?.mcp?.servers ?? []), ...pluginMcpServers].map((server) => [
      server.id,
      server.transport === "http"
        ? server
        : {
            ...server,
            ...(globalInheritEnv.length > 0 || server.inheritEnv
              ? { inheritEnv: [...globalInheritEnv, ...(server.inheritEnv ?? [])] }
              : {}),
            ...(server.cwd ? { cwd: resolveConfigPath(server.cwd, configDir) } : {}),
          },
    ]),
  );
}

async function resolveAgentMcpConfig(
  mcp: AgentMcpToolsConfig,
  mcpServers: Map<string, McpServerConfig>,
  agent: AppConfig["agents"][number],
  configDir: string,
  options: ResolveRuntimeConfigOptions,
): Promise<AgentMcpConfig> {
  return {
    servers: await Promise.all(mcp.servers.map(async (serverRef) => {
      const serverId = getAgentMcpServerReferenceId(serverRef);
      const server = mcpServers.get(serverId);
      if (!server) {
        throw new Error(`Unknown MCP server id "${serverId}".`);
      }

      const resolvedServer = await resolveAgentMcpServerSecrets(
        renderAgentMcpServerTemplates(server, agent),
        configDir,
        options,
      );

      return applyAgentMcpToolFilter(
        resolvedServer,
        resolveAgentMcpToolFilter(serverRef),
      );
    })),
  };
}

function getAgentMcpServerReferenceId(serverRef: AgentMcpToolsConfig["servers"][number]): string {
  return typeof serverRef === "string" ? serverRef : serverRef.id;
}

function resolveAgentMcpToolFilter(
  serverRef: AgentMcpToolsConfig["servers"][number],
): AgentMcpToolFilter | undefined {
  if (typeof serverRef === "string") {
    return undefined;
  }

  const filter = {
    ...(serverRef.includeTools ? { include: serverRef.includeTools } : {}),
    ...(serverRef.excludeTools ? { exclude: serverRef.excludeTools } : {}),
  };

  return Object.keys(filter).length > 0 ? filter : undefined;
}

function applyAgentMcpToolFilter(
  server: AgentMcpServerConfig,
  toolFilter: AgentMcpToolFilter | undefined,
): AgentMcpServerConfig {
  return toolFilter ? { ...server, toolFilter } : server;
}

function renderAgentMcpServerTemplates(
  server: McpServerConfig,
  agent: AppConfig["agents"][number],
): McpServerConfig {
  if (server.transport === "http") {
    const bearerToken = renderSecretValueTemplate(server.bearerToken, agent);

    return {
      ...server,
      url: renderAgentTemplate(server.url, agent),
      ...(server.headers ? { headers: mapRecordValues(server.headers, (value) => renderAgentTemplate(value, agent)) } : {}),
      ...(bearerToken ? { bearerToken } : {}),
    };
  }

  return {
    ...server,
    command: renderAgentTemplate(server.command, agent),
    ...(server.args ? { args: server.args.map((arg) => renderAgentTemplate(arg, agent)) } : {}),
    ...(server.inheritEnv ? { inheritEnv: server.inheritEnv.map((entry) => renderAgentTemplate(entry, agent)) } : {}),
    ...(server.env ? { env: mapRecordValues(server.env, (value) => renderAgentTemplate(value, agent)) } : {}),
    ...(server.cwd ? { cwd: renderAgentTemplate(server.cwd, agent) } : {}),
  };
}

async function resolveAgentMcpServerSecrets(
  server: McpServerConfig,
  configDir: string,
  options: ResolveRuntimeConfigOptions,
): Promise<AgentMcpServerConfig> {
  if (server.transport !== "http") {
    return server;
  }

  const { bearerToken, ...resolvedServer } = server;
  return {
    ...resolvedServer,
    ...(bearerToken
      ? {
          bearerToken: await resolveSecretValue(bearerToken, {
            configDir,
            env: options.env,
            readTextFile: options.readTextFile,
            fieldLabel: `tools.mcp.servers.${server.id}.bearerToken`,
          }),
        }
      : {}),
  };
}

function renderSecretValueTemplate(
  value: SecretValueConfig | undefined,
  agent: AppConfig["agents"][number],
): SecretValueConfig | undefined {
  if (!value || typeof value === "string") {
    return value;
  }

  return {
    ...(value.env ? { env: renderAgentTemplate(value.env, agent) } : {}),
    ...(value.file ? { file: renderAgentTemplate(value.file, agent) } : {}),
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
