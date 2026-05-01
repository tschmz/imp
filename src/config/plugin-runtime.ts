import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMcpServerConfig } from "../domain/agent.js";
import { discoverPluginManifests, readPluginManifestFromDirectory, type DiscoveredPluginManifest, type PluginManifest } from "../plugins/index.js";
import { createCommandToolDefinitions, type CommandToolRuntimeConfig } from "../runtime/command-tool.js";
import { loadJsPluginToolDefinitions, resolvePluginJsRuntime } from "../runtime/js-plugin.js";
import type { ToolDefinition } from "../tools/types.js";
import { resolveConfigPath } from "./secret-value.js";
import type { AgentConfig, AppConfig } from "./types.js";

export interface LoadedRuntimePlugins {
  skillPaths: string[];
  agents: AgentConfig[];
  mcpServers: AgentMcpServerConfig[];
  commandTools: CommandToolRuntimeConfig[];
  pluginTools: ToolDefinition[];
  toolNameAliases: Record<string, string>;
}

export interface LoadedPluginConfigContributions {
  agents: AgentConfig[];
}

export async function loadPluginConfigContributions(
  appConfig: AppConfig,
  configDir: string,
): Promise<LoadedPluginConfigContributions> {
  const loaded: LoadedPluginConfigContributions = {
    agents: [],
  };
  const plugins = await discoverRuntimePlugins(appConfig, configDir);

  for (const plugin of plugins) {
    const manifest = plugin.manifest;
    const pluginRoot = plugin.rootDir;
    const localToolNames = new Set((manifest.tools ?? []).map((tool) => tool.name));

    loaded.agents.push(...resolvePluginAgents(manifest, pluginRoot, appConfig.paths.dataRoot, localToolNames));
  }

  return {
    agents: filterShadowedPluginAgents(appConfig.agents, loaded.agents),
  };
}

export async function loadRuntimePlugins(appConfig: AppConfig, configDir: string): Promise<LoadedRuntimePlugins> {
  const loaded: LoadedRuntimePlugins = {
    skillPaths: [],
    agents: [],
    mcpServers: [],
    commandTools: [],
    pluginTools: [],
    toolNameAliases: {},
  };

  const plugins = await discoverRuntimePlugins(appConfig, configDir);

  for (const plugin of plugins) {
    const manifest = plugin.manifest;
    const pluginRoot = plugin.rootDir;

    const commandTools = resolvePluginCommandTools(manifest, pluginRoot);
    const jsRuntime = resolvePluginJsRuntime(manifest, pluginRoot);
    const jsTools = jsRuntime ? await loadJsPluginToolDefinitions([jsRuntime]) : [];
    const localToolNames = new Set([
      ...(manifest.tools ?? []).map((tool) => tool.name),
      ...jsTools.map((tool) => stripPluginNamespace(manifest.id, tool.name)),
    ]);
    for (const localToolName of localToolNames) {
      loaded.toolNameAliases[`${manifest.id}.${localToolName}`] = namespacePluginToolId(manifest.id, localToolName);
    }

    loaded.skillPaths.push(...resolvePluginSkillPaths(manifest, pluginRoot));
    loaded.agents.push(...resolvePluginAgents(manifest, pluginRoot, appConfig.paths.dataRoot, localToolNames));
    loaded.mcpServers.push(...resolvePluginMcpServers(manifest, pluginRoot));
    loaded.commandTools.push(...commandTools);
    loaded.pluginTools.push(...createCommandToolDefinitions(commandTools), ...jsTools);
  }

  return loaded;
}

interface RuntimePluginCandidate {
  plugin: DiscoveredPluginManifest;
  sourceOrder: number;
}

async function discoverRuntimePlugins(appConfig: AppConfig, configDir: string): Promise<DiscoveredPluginManifest[]> {
  const disabledPluginIds = new Set(
    (appConfig.plugins ?? []).filter((plugin) => !plugin.enabled).map((plugin) => plugin.id),
  );
  const candidates = new Map<string, RuntimePluginCandidate>();
  let sourceOrder = 0;

  for (const plugin of await discoverPluginsFromRoots(resolveAutomaticPluginRoots(appConfig, configDir))) {
    if (disabledPluginIds.has(plugin.manifest.id)) {
      continue;
    }

    candidates.set(plugin.manifest.id, { plugin, sourceOrder: sourceOrder++ });
  }

  for (const pluginConfig of appConfig.plugins ?? []) {
    if (!pluginConfig.enabled || !pluginConfig.package?.path) {
      continue;
    }

    const pluginRoot = resolveConfigPath(pluginConfig.package.path, configDir);
    const discovered = await readPluginManifestFromDirectory(pluginRoot);
    if ("issue" in discovered) {
      if (isMissingManifest(discovered.issue.message)) {
        continue;
      }
      throw new Error(`Could not load plugin "${pluginConfig.id}" from ${pluginRoot}: ${discovered.issue.message}`);
    }

    if (discovered.plugin.manifest.id !== pluginConfig.id) {
      throw new Error(
        `Configured plugin "${pluginConfig.id}" loaded manifest for "${discovered.plugin.manifest.id}" from ${discovered.plugin.manifestPath}.`,
      );
    }

    candidates.set(discovered.plugin.manifest.id, { plugin: discovered.plugin, sourceOrder: sourceOrder++ });
  }

  return [...candidates.values()]
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map((candidate) => candidate.plugin);
}

async function discoverPluginsFromRoots(rootDirs: string[]): Promise<DiscoveredPluginManifest[]> {
  const result = await discoverPluginManifests(rootDirs);
  const relevantIssues = result.issues.filter((issue) => !isMissingManifest(issue.message));
  if (relevantIssues.length > 0) {
    throw new Error(
      relevantIssues
        .map((issue) => `Could not load plugins from ${issue.path}: ${issue.message}`)
        .join("\n"),
    );
  }

  return result.plugins;
}

function resolveAutomaticPluginRoots(appConfig: AppConfig, configDir: string): string[] {
  return [
    join(appConfig.paths.dataRoot, "plugins"),
    join(homedir(), ".agents", "plugins"),
    ...appConfig.agents.flatMap((agent) => {
      const roots = [join(resolveAgentHomePath(agent, appConfig.paths.dataRoot, configDir), ".plugins")];

      if (agent.workspace?.cwd) {
        roots.push(join(resolveConfigPath(agent.workspace.cwd, configDir), ".agents", "plugins"));
      }

      return roots;
    }),
  ];
}

function resolveAgentHomePath(agent: AgentConfig, dataRoot: string, configDir: string): string {
  return resolveConfigPath(agent.home ?? join(dataRoot, "agents", agent.id), configDir);
}


function resolvePluginSkillPaths(manifest: PluginManifest, pluginRoot: string): string[] {
  return (manifest.skills ?? []).map((skill) => resolveConfigPath(skill.path, pluginRoot));
}

function resolvePluginAgents(
  manifest: PluginManifest,
  pluginRoot: string,
  dataRoot: string,
  localToolNames: Set<string>,
): AgentConfig[] {
  return (manifest.agents ?? []).map((agent) => {
    const agentId = namespacePluginId(manifest.id, agent.id);
    return {
      ...agent,
      id: agentId,
      ...(agent.model ? { model: resolvePluginModel(agent.model, pluginRoot) } : {}),
      ...(agent.prompt ? { prompt: resolvePluginPrompt(agent.prompt, pluginRoot) } : {}),
      home: agent.home
        ? resolveConfigPath(agent.home, pluginRoot)
        : join(dataRoot, "agents", agentId),
      ...(agent.workspace?.cwd
        ? { workspace: { ...agent.workspace, cwd: resolveConfigPath(agent.workspace.cwd, pluginRoot) } }
        : {}),
      ...(agent.skills ? { skills: { paths: agent.skills.paths.map((path) => resolveConfigPath(path, pluginRoot)) } } : {}),
      ...(agent.tools ? { tools: resolvePluginAgentTools(manifest, agent.tools, localToolNames) } : {}),
    };
  });
}

function resolvePluginModel(
  model: NonNullable<AgentConfig["model"]>,
  pluginRoot: string,
): NonNullable<AgentConfig["model"]> {
  return {
    ...model,
    ...(model.authFile ? { authFile: resolveConfigPath(model.authFile, pluginRoot) } : {}),
    ...(model.apiKey ? { apiKey: resolvePluginSecretValue(model.apiKey, pluginRoot) } : {}),
  };
}

function resolvePluginSecretValue(
  value: NonNullable<NonNullable<AgentConfig["model"]>["apiKey"]>,
  pluginRoot: string,
): NonNullable<NonNullable<AgentConfig["model"]>["apiKey"]> {
  if (typeof value === "string" || !("file" in value) || !value.file) {
    return value;
  }

  return {
    ...value,
    file: resolveConfigPath(value.file, pluginRoot),
  };
}

function resolvePluginPrompt(prompt: NonNullable<AgentConfig["prompt"]>, pluginRoot: string): NonNullable<AgentConfig["prompt"]> {
  return {
    ...(prompt.base ? { base: resolvePluginPromptSource(prompt.base, pluginRoot) } : {}),
    ...(prompt.instructions
      ? { instructions: prompt.instructions.map((source) => resolvePluginPromptSource(source, pluginRoot)) }
      : {}),
    ...(prompt.references
      ? { references: prompt.references.map((source) => resolvePluginPromptSource(source, pluginRoot)) }
      : {}),
  };
}

function resolvePluginPromptSource(source: { text?: string; file?: string }, pluginRoot: string): { text?: string; file?: string } {
  if (source.file) {
    return { file: resolveConfigPath(source.file, pluginRoot) };
  }

  return source;
}

function resolvePluginAgentTools(
  manifest: PluginManifest,
  tools: NonNullable<AgentConfig["tools"]>,
  localToolNames: Set<string>,
): NonNullable<AgentConfig["tools"]> {
  const localMcpServerIds = new Set((manifest.mcpServers ?? []).map((server) => server.id));

  if (Array.isArray(tools)) {
    return tools.map((toolName) => namespacePluginReference(manifest.id, toolName, localToolNames));
  }

  return {
    ...(tools.builtIn
      ? { builtIn: tools.builtIn.map((toolName) => namespacePluginReference(manifest.id, toolName, localToolNames)) }
      : {}),
    ...(tools.mcp
      ? { mcp: { servers: tools.mcp.servers.map((serverId) => namespacePluginMcpReference(manifest.id, serverId, localMcpServerIds)) } }
      : {}),
    ...(tools.phone ? { phone: tools.phone } : {}),
    ...(tools.agents ? { agents: tools.agents } : {}),
  };
}

function resolvePluginMcpServers(manifest: PluginManifest, pluginRoot: string): AgentMcpServerConfig[] {
  return (manifest.mcpServers ?? []).map((server) => ({
    ...server,
    id: namespacePluginId(manifest.id, server.id),
    ...(server.cwd ? { cwd: resolveConfigPath(server.cwd, pluginRoot) } : {}),
  }));
}

function resolvePluginCommandTools(manifest: PluginManifest, pluginRoot: string): CommandToolRuntimeConfig[] {
  return (manifest.tools ?? []).map((tool) => ({
    pluginId: manifest.id,
    pluginRoot,
    manifest: tool,
  }));
}

export function filterShadowedPluginAgents(
  configAgents: AppConfig["agents"],
  pluginAgents: AppConfig["agents"],
): AppConfig["agents"] {
  const agentIds = new Set(configAgents.map((agent) => agent.id));
  return pluginAgents.filter((agent) => !agentIds.has(agent.id));
}

function namespacePluginReference(pluginId: string, id: string, localIds: Set<string>): string {
  return !id.includes(".") && !id.includes("__") && localIds.has(id) ? namespacePluginToolId(pluginId, id) : id;
}

function namespacePluginToolId(pluginId: string, id: string): string {
  return `${pluginId}__${id}`;
}

function namespacePluginMcpReference(pluginId: string, id: string, localIds: Set<string>): string {
  return !id.includes(".") && localIds.has(id) ? namespacePluginId(pluginId, id) : id;
}

function namespacePluginId(pluginId: string, id: string): string {
  return `${pluginId}.${id}`;
}

function isMissingManifest(message: string): boolean {
  return message.includes("ENOENT") || message.includes("no such file or directory");
}

function stripPluginNamespace(pluginId: string, id: string): string {
  const prefix = `${pluginId}__`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
