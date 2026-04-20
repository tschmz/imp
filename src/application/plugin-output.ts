import type { DiscoveredPluginManifest } from "../plugins/discovery.js";

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
}): string[] {
  const lines = [`Installed plugin "${options.pluginId}" into ${options.configPath}`];
  if (options.endpointIds.length > 0) {
    lines.push(`Added endpoints: ${options.endpointIds.join(", ")}`);
  }
  return lines;
}
