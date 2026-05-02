import type { DiscoveredPluginManifest } from "../plugins/discovery.js";
import type { PluginConfigUpdateChanges } from "./plugin-config-installer.js";

export function renderPluginListEntry(plugin: DiscoveredPluginManifest): string {
  const description = plugin.manifest.description ? ` - ${plugin.manifest.description}` : "";
  return `${plugin.manifest.id}\t${plugin.manifest.name} ${plugin.manifest.version}${description}`;
}

export function renderPluginDetails(plugin: DiscoveredPluginManifest): string {
  const lines = [
    `${plugin.manifest.name} (${plugin.manifest.id})`,
    `Version: ${plugin.manifest.version}`,
    `Root: ${plugin.rootDir}`,
    `Manifest: ${plugin.manifestPath}`,
  ];

  if (plugin.manifest.description) {
    lines.push(`Description: ${plugin.manifest.description}`);
  }

  if (plugin.manifest.capabilities?.length) {
    lines.push(`Capabilities: ${plugin.manifest.capabilities.join(", ")}`);
  }

  if (plugin.manifest.runtime) {
    lines.push("");
    lines.push("Runtime:");
    lines.push(`- js: ${plugin.manifest.runtime.module}`);
  }

  if (plugin.manifest.agents?.length) {
    lines.push("");
    lines.push("Agents:");
    for (const agent of plugin.manifest.agents) {
      const label = agent.name ? `${agent.id} (${agent.name})` : agent.id;
      const details = renderAgentDetails(agent);
      lines.push(`- ${label}${details.length > 0 ? `: ${details.join("; ")}` : ""}`);
    }
  }

  if (plugin.manifest.skills?.length) {
    lines.push("");
    lines.push("Skills:");
    for (const skill of plugin.manifest.skills) {
      lines.push(`- ${skill.path}`);
    }
  }

  if (plugin.manifest.tools?.length) {
    lines.push("");
    lines.push("Command tools:");
    for (const tool of plugin.manifest.tools) {
      lines.push(`- ${tool.name}: ${tool.description}`);
    }
  }

  if (plugin.manifest.endpoints?.length) {
    lines.push("");
    lines.push("Endpoints:");
    for (const endpoint of plugin.manifest.endpoints) {
      lines.push(`- ${endpoint.id}: response=${endpoint.response.type}`);
    }
  }

  if (plugin.manifest.services?.length) {
    lines.push("");
    lines.push("Services:");
    for (const service of plugin.manifest.services) {
      lines.push(`- ${service.id}: ${service.command}${service.args?.length ? ` ${service.args.join(" ")}` : ""}`);
    }
  }

  if (plugin.manifest.mcpServers?.length) {
    lines.push("");
    lines.push("MCP servers:");
    for (const server of plugin.manifest.mcpServers) {
      lines.push(`- ${server.id}: ${server.command}${server.args?.length ? ` ${server.args.join(" ")}` : ""}`);
    }
  }

  if (plugin.manifest.init?.configTemplate) {
    lines.push("");
    lines.push(`Config template: ${plugin.manifest.init.configTemplate}`);
  }

  return lines.join("\n");
}

function renderAgentDetails(agent: NonNullable<DiscoveredPluginManifest["manifest"]["agents"]>[number]): string[] {
  const details: string[] = [];
  const toolNames = renderAgentToolNames(agent.tools);
  if (toolNames.length > 0) {
    details.push(`tools=${toolNames.join(", ")}`);
  }
  if (agent.skills?.paths.length) {
    details.push(`skills=${agent.skills.paths.join(", ")}`);
  }
  if (agent.prompt?.base?.file) {
    details.push(`prompt=${agent.prompt.base.file}`);
  }
  return details;
}

function renderAgentToolNames(tools: NonNullable<DiscoveredPluginManifest["manifest"]["agents"]>[number]["tools"]): string[] {
  if (!tools) {
    return [];
  }
  if (Array.isArray(tools)) {
    return tools;
  }
  return [
    ...(tools.builtIn ?? []),
    ...(tools.mcp?.servers.map((server) => `mcp:${server}`) ?? []),
    ...(tools.agents?.map((delegation) => `agent:${delegation.agentId}`) ?? []),
  ];
}

export function renderPluginListOutput(options: {
  plugins: DiscoveredPluginManifest[];
  issues: Array<{ path: string; message: string }>;
}): string {
  const lines = options.plugins.map((plugin) => renderPluginListEntry(plugin));
  if (lines.length === 0) {
    lines.push("No plugins found.");
  }

  if (options.issues.length > 0) {
    lines.push("");
    lines.push("Issues:");
    lines.push(...options.issues.map((issue) => `- ${issue.path}: ${issue.message}`));
  }

  return lines.join("\n");
}

export function renderPluginInstallSummary(options: {
  pluginId: string;
  configPath: string;
  endpointIds: string[];
  mcpServerIds: string[];
}): string[] {
  const lines = [`Installed plugin "${options.pluginId}" into ${options.configPath}`];
  if (options.endpointIds.length > 0) {
    lines.push(`Added endpoints: ${options.endpointIds.join(", ")}`);
  }
  if (options.mcpServerIds.length > 0) {
    lines.push(`Added MCP servers: ${options.mcpServerIds.join(", ")}`);
  }
  return lines;
}

export function renderPluginUpdateSummary(options: {
  pluginId: string;
  configPath: string;
  changes: PluginConfigUpdateChanges;
}): string[] {
  const lines = [`Updated plugin "${options.pluginId}" in ${options.configPath}`];
  if (options.changes.previousVersion && options.changes.previousVersion !== options.changes.nextVersion) {
    lines.push(`Version: ${options.changes.previousVersion} -> ${options.changes.nextVersion}`);
  } else {
    lines.push(`Version: ${options.changes.nextVersion}`);
  }

  appendChangedIds(lines, "Added endpoints", options.changes.addedEndpointIds);
  appendChangedIds(lines, "Updated endpoints", options.changes.updatedEndpointIds);
  appendChangedIds(lines, "Removed endpoints", options.changes.removedEndpointIds);
  appendChangedIds(lines, "Preserved modified endpoints", options.changes.preservedEndpointIds);
  appendChangedIds(lines, "Added MCP servers", options.changes.addedMcpServerIds);
  appendChangedIds(lines, "Updated MCP servers", options.changes.updatedMcpServerIds);
  appendChangedIds(lines, "Removed MCP servers", options.changes.removedMcpServerIds);
  appendChangedIds(lines, "Preserved modified MCP servers", options.changes.preservedMcpServerIds);
  return lines;
}

function appendChangedIds(lines: string[], label: string, ids: string[]): void {
  if (ids.length > 0) {
    lines.push(`${label}: ${ids.join(", ")}`);
  }
}
