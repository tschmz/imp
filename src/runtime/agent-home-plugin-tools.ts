import { join } from "node:path";
import type { AgentDefinition } from "../domain/agent.js";
import { discoverPluginManifests } from "../plugins/discovery.js";
import { createCommandToolDefinitions } from "./command-tool.js";
import { loadJsPluginToolDefinitions, resolvePluginJsRuntime } from "./js-plugin.js";
import type { ToolDefinition } from "../tools/types.js";

export interface AgentHomePluginToolResolution {
  tools: ToolDefinition[];
  automaticToolNames: string[];
  toolNameAliases: Record<string, string>;
}

export async function loadAgentHomePluginTools(agent: AgentDefinition): Promise<AgentHomePluginToolResolution> {
  if (!agent.home) {
    return emptyResolution();
  }

  const pluginRoot = join(agent.home, ".plugins");
  const result = await discoverPluginManifests([pluginRoot]);
  const relevantIssues = result.issues.filter((issue) => !isMissingPath(issue.message));
  if (relevantIssues.length > 0) {
    throw new Error(
      relevantIssues
        .map((issue) => `Could not load agent-home plugins from ${issue.path}: ${issue.message}`)
        .join("\n"),
    );
  }

  const toolsByName = new Map<string, ToolDefinition>();
  const automaticToolNames: string[] = [];
  const toolNameAliases: Record<string, string> = {};

  for (const plugin of result.plugins) {
    const commandTools = createCommandToolDefinitions((plugin.manifest.tools ?? []).map((tool) => ({
      pluginId: plugin.manifest.id,
      pluginRoot: plugin.rootDir,
      manifest: tool,
    })));
    const jsRuntime = resolvePluginJsRuntime(plugin.manifest, plugin.rootDir);
    const jsTools = jsRuntime
      ? await loadJsPluginToolDefinitions([jsRuntime], { reload: true })
      : [];
    const localToolNames = [
      ...(plugin.manifest.tools ?? []).map((tool) => tool.name),
      ...jsTools.map((tool) => stripPluginNamespace(plugin.manifest.id, tool.name)),
    ];

    for (const localToolName of localToolNames) {
      const namespacedToolName = namespacePluginToolId(plugin.manifest.id, localToolName);
      automaticToolNames.push(namespacedToolName);
      toolNameAliases[`${plugin.manifest.id}.${localToolName}`] = namespacedToolName;
    }

    for (const tool of [...commandTools, ...jsTools]) {
      toolsByName.set(tool.name, tool);
    }
  }

  return {
    tools: [...toolsByName.values()],
    automaticToolNames: dedupe(automaticToolNames),
    toolNameAliases,
  };
}

function emptyResolution(): AgentHomePluginToolResolution {
  return {
    tools: [],
    automaticToolNames: [],
    toolNameAliases: {},
  };
}

function namespacePluginToolId(pluginId: string, id: string): string {
  return `${pluginId}__${id}`;
}

function stripPluginNamespace(pluginId: string, id: string): string {
  const prefix = `${pluginId}__`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function isMissingPath(message: string): boolean {
  return message.includes("ENOENT") || message.includes("no such file or directory");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
