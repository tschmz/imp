import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function registerPlugin(context) {
  return {
    tools: [
      {
        name: "describeManifest",
        label: "describeManifest",
        description: "Read an Imp plugin manifest and summarize the capabilities and names it registers.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              minLength: 1,
              description: "Path to plugin.json or imp-plugin.json. Relative paths resolve from the current process working directory."
            }
          },
          required: ["path"],
          additionalProperties: false
        },
        async execute(_toolCallId, params) {
          const manifestPath = parseManifestPath(params);
          const raw = await readFile(manifestPath, "utf8");
          const manifest = JSON.parse(raw);
          const text = describeManifest(manifest, manifestPath, context.plugin.id);
          return {
            content: [{ type: "text", text }],
            details: {
              pluginId: manifest.id,
              manifestPath,
              capabilityCounts: countCapabilities(manifest)
            }
          };
        }
      }
    ]
  };
}

function parseManifestPath(params) {
  if (!params || typeof params !== "object" || typeof params.path !== "string" || params.path.trim().length === 0) {
    throw new Error("describeManifest requires a non-empty path string.");
  }

  return resolve(params.path);
}

function describeManifest(manifest, manifestPath, devkitPluginId) {
  const pluginId = typeof manifest.id === "string" && manifest.id.length > 0 ? manifest.id : "<missing-id>";
  const lines = [
    `Manifest: ${manifestPath}`,
    `Plugin: ${pluginId}`,
    `Name: ${manifest.name ?? "<missing-name>"}`,
    `Version: ${manifest.version ?? "<missing-version>"}`,
    "",
    "Registered capabilities:"
  ];

  appendList(lines, "agents", manifest.agents, (agent) => `${pluginId}.${agent.id ?? "<missing-id>"}`);
  appendList(lines, "command tools", manifest.tools, (tool) => `${pluginId}__${tool.name ?? "<missing-name>"}`);
  if (manifest.runtime?.module) {
    lines.push(`- JS runtime: ${manifest.runtime.module} (tools are registered by the module and namespaced as ${pluginId}__<tool>)`);
  }
  appendList(lines, "MCP servers", manifest.mcpServers, (server) => `${pluginId}.${server.id ?? "<missing-id>"}`);
  appendList(lines, "skills", manifest.skills, (skill) => skill.path ?? "<missing-path>");
  appendList(lines, "file endpoints", manifest.endpoints, (endpoint) => endpoint.id ?? "<missing-id>");
  appendList(lines, "services", manifest.services, (service) => service.id ?? "<missing-id>");

  const warnings = collectWarnings(manifest, pluginId, devkitPluginId);
  lines.push("", "Warnings:");
  if (warnings.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n");
}

function appendList(lines, label, values, render) {
  if (!Array.isArray(values) || values.length === 0) {
    lines.push(`- ${label}: none`);
    return;
  }

  lines.push(`- ${label}:`);
  for (const value of values) {
    lines.push(`  - ${render(value)}`);
  }
}

function collectWarnings(manifest, pluginId, devkitPluginId) {
  const warnings = [];
  if (manifest.schemaVersion !== 1) {
    warnings.push("schemaVersion should be 1 for the current Imp plugin manifest schema.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(pluginId)) {
    warnings.push("plugin id should contain only letters, numbers, hyphens, and underscores.");
  }
  if (manifest.runtime?.module) {
    warnings.push("runtime.module runs trusted JS in the Imp process. Prefer command tools for untrusted code.");
  }
  if (pluginId === devkitPluginId) {
    warnings.push("this is the DevKit plugin itself; avoid using it as a template without changing id, name, and tool descriptions.");
  }
  return warnings;
}

function countCapabilities(manifest) {
  return {
    agents: Array.isArray(manifest.agents) ? manifest.agents.length : 0,
    commandTools: Array.isArray(manifest.tools) ? manifest.tools.length : 0,
    mcpServers: Array.isArray(manifest.mcpServers) ? manifest.mcpServers.length : 0,
    skills: Array.isArray(manifest.skills) ? manifest.skills.length : 0,
    endpoints: Array.isArray(manifest.endpoints) ? manifest.endpoints.length : 0,
    services: Array.isArray(manifest.services) ? manifest.services.length : 0,
    hasRuntimeModule: Boolean(manifest.runtime?.module)
  };
}
