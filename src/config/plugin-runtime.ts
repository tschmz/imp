import { join } from "node:path";
import type { AgentMcpServerConfig } from "../domain/agent.js";
import { readPluginManifestFromDirectory, type PluginManifest } from "../plugins/index.js";
import type { CommandToolRuntimeConfig } from "../runtime/command-tool.js";
import { resolveConfigPath } from "./secret-value.js";
import type { AgentConfig, AppConfig } from "./types.js";

export interface LoadedRuntimePlugins {
  skillPaths: string[];
  agents: AgentConfig[];
  mcpServers: AgentMcpServerConfig[];
  commandTools: CommandToolRuntimeConfig[];
}

export async function loadEnabledRuntimePlugins(appConfig: AppConfig, configDir: string): Promise<LoadedRuntimePlugins> {
  const loaded: LoadedRuntimePlugins = {
    skillPaths: [],
    agents: [],
    mcpServers: [],
    commandTools: [],
  };

  for (const pluginConfig of appConfig.plugins ?? []) {
    if (!pluginConfig.enabled) {
      continue;
    }

    const pluginRoot = resolvePluginRoot(appConfig, pluginConfig.id, pluginConfig.package?.path, configDir);
    const discovered = await readPluginManifestFromDirectory(pluginRoot);
    if ("issue" in discovered) {
      if (pluginConfig.package?.path && isMissingManifest(discovered.issue.message)) {
        continue;
      }
      throw new Error(`Could not load plugin "${pluginConfig.id}" from ${pluginRoot}: ${discovered.issue.message}`);
    }

    const manifest = discovered.plugin.manifest;
    if (manifest.id !== pluginConfig.id) {
      throw new Error(
        `Configured plugin "${pluginConfig.id}" loaded manifest for "${manifest.id}" from ${discovered.plugin.manifestPath}.`,
      );
    }

    loaded.skillPaths.push(...resolvePluginSkillPaths(manifest, pluginRoot));
    loaded.agents.push(...resolvePluginAgents(manifest, pluginRoot));
    loaded.mcpServers.push(...resolvePluginMcpServers(manifest, pluginRoot));
    loaded.commandTools.push(...resolvePluginCommandTools(manifest, pluginRoot));
  }

  return loaded;
}

function resolvePluginRoot(appConfig: AppConfig, pluginId: string, packagePath: string | undefined, configDir: string): string {
  if (packagePath) {
    return resolveConfigPath(packagePath, configDir);
  }

  return join(appConfig.paths.dataRoot, "plugins", pluginId);
}

function resolvePluginSkillPaths(manifest: PluginManifest, pluginRoot: string): string[] {
  return (manifest.skills ?? []).map((skill) => resolveConfigPath(skill.path, pluginRoot));
}

function resolvePluginAgents(manifest: PluginManifest, pluginRoot: string): AgentConfig[] {
  return (manifest.agents ?? []).map((agent) => {
    const agentId = namespacePluginId(manifest.id, agent.id);
    return {
      ...agent,
      id: agentId,
      ...(agent.prompt ? { prompt: resolvePluginPrompt(agent.prompt, pluginRoot) } : {}),
      ...(agent.home ? { home: resolveConfigPath(agent.home, pluginRoot) } : {}),
      ...(agent.authFile ? { authFile: resolveConfigPath(agent.authFile, pluginRoot) } : {}),
      ...(agent.workspace?.cwd
        ? { workspace: { ...agent.workspace, cwd: resolveConfigPath(agent.workspace.cwd, pluginRoot) } }
        : {}),
      ...(agent.skills ? { skills: { paths: agent.skills.paths.map((path) => resolveConfigPath(path, pluginRoot)) } } : {}),
      ...(agent.tools ? { tools: resolvePluginAgentTools(manifest, agent.tools) } : {}),
    };
  });
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

function resolvePluginAgentTools(manifest: PluginManifest, tools: NonNullable<AgentConfig["tools"]>): NonNullable<AgentConfig["tools"]> {
  const localToolNames = new Set((manifest.tools ?? []).map((tool) => tool.name));
  const localMcpServerIds = new Set((manifest.mcpServers ?? []).map((server) => server.id));

  if (Array.isArray(tools)) {
    return tools.map((toolName) => namespacePluginReference(manifest.id, toolName, localToolNames));
  }

  return {
    ...(tools.builtIn
      ? { builtIn: tools.builtIn.map((toolName) => namespacePluginReference(manifest.id, toolName, localToolNames)) }
      : {}),
    ...(tools.mcp
      ? { mcp: { servers: tools.mcp.servers.map((serverId) => namespacePluginReference(manifest.id, serverId, localMcpServerIds)) } }
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

function namespacePluginReference(pluginId: string, id: string, localIds: Set<string>): string {
  return !id.includes(".") && localIds.has(id) ? namespacePluginId(pluginId, id) : id;
}

function namespacePluginId(pluginId: string, id: string): string {
  return `${pluginId}.${id}`;
}

function isMissingManifest(message: string): boolean {
  return message.includes("ENOENT") || message.includes("no such file or directory");
}
