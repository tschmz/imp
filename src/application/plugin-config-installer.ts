import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { parseConfigJson } from "../config/config-json.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { appConfigSchema } from "../config/schema.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "../config/secret-value.js";
import type { AppConfig, EndpointConfig, PluginConfig, FileEndpointConfig } from "../config/types.js";
import type { DiscoveredPluginManifest } from "../plugins/discovery.js";
import { readPluginManifest } from "../plugins/discovery.js";
import { PLUGIN_MANIFEST_FILE } from "../plugins/manifest.js";

export interface PluginConfigInstallerDependencies {
  discoverConfigPath?: typeof discoverConfigPath;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface PluginConfigUpdateResult {
  config: AppConfig;
  changes: PluginConfigUpdateChanges;
}

export interface PluginConfigUpdateChanges {
  previousVersion?: string;
  nextVersion: string;
  previousManifestHash?: string;
  nextManifestHash: string;
  addedEndpointIds: string[];
  updatedEndpointIds: string[];
  removedEndpointIds: string[];
  preservedEndpointIds: string[];
  addedMcpServerIds: string[];
  updatedMcpServerIds: string[];
  removedMcpServerIds: string[];
  preservedMcpServerIds: string[];
}

interface PluginConfigContributions {
  pluginConfig: PluginConfig;
  endpoints: FileEndpointConfig[];
  mcpServers: McpServerConfig[];
}

type McpServerConfig = NonNullable<NonNullable<AppConfig["tools"]>["mcp"]>["servers"][number];

export function createPluginConfigInstaller(dependencies: PluginConfigInstallerDependencies = {}) {
  const discoverConfig = dependencies.discoverConfigPath ?? discoverConfigPath;
  const readText = dependencies.readTextFile ?? ((path: string) => readFile(path, "utf8"));
  const writeText = dependencies.writeTextFile ?? ((path: string, content: string) => writeFile(path, content, "utf8"));

  return {
    async readValidatedConfig(options: { configPath?: string }): Promise<{ configPath: string; config: AppConfig }> {
      const { configPath } = await discoverConfig({
        cliConfigPath: options.configPath,
      });
      const rawConfig = await readText(configPath);
      return {
        configPath,
        config: parseAndValidateConfig(rawConfig, configPath),
      };
    },

    async writeConfig(configPath: string, config: AppConfig): Promise<void> {
      await writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
    },
  };
}

export function parseAndValidateConfig(rawConfig: string, configPath: string): AppConfig {
  const parsedConfig = parseConfigJson(rawConfig, {
    errorPrefix: `Invalid config file ${configPath}`,
  });
  const configResult = appConfigSchema.safeParse(parsedConfig);
  if (!configResult.success) {
    throw new Error(
      [
        `Invalid config file ${configPath}`,
        ...configResult.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
      ].join("\n"),
    );
  }

  return configResult.data;
}

export function installPluginIntoConfig(
  config: AppConfig,
  plugin: DiscoveredPluginManifest,
  configPath: string,
): AppConfig {
  assertPluginCanBeInstalled(config, plugin);
  const contributions = createPluginConfigContributions(config, plugin, configPath);

  const updatedConfig: AppConfig = {
    ...config,
    ...(contributions.mcpServers.length > 0
      ? {
          tools: {
            ...(config.tools ?? {}),
            mcp: {
              ...(config.tools?.mcp?.inheritEnv ? { inheritEnv: config.tools.mcp.inheritEnv } : {}),
              servers: [...(config.tools?.mcp?.servers ?? []), ...contributions.mcpServers],
            },
          },
        }
      : {}),
    plugins: [...(config.plugins ?? []), contributions.pluginConfig],
    endpoints: [...config.endpoints, ...contributions.endpoints],
  };

  return validatePluginUpdatedConfig(updatedConfig, plugin.manifest.id);
}

export function updatePluginInConfig(
  config: AppConfig,
  plugin: DiscoveredPluginManifest,
  configPath: string,
  previousPlugin?: DiscoveredPluginManifest,
): PluginConfigUpdateResult {
  const pluginIndex = (config.plugins ?? []).findIndex((entry) => entry.id === plugin.manifest.id);
  if (pluginIndex < 0) {
    throw new Error(`Plugin "${plugin.manifest.id}" is not configured.`);
  }

  const nextContributions = createPluginConfigContributions(config, plugin, configPath);
  const previousContributions = previousPlugin?.manifest.id === plugin.manifest.id
    ? createPluginConfigContributions(config, previousPlugin, configPath)
    : undefined;
  const currentPluginConfig = config.plugins![pluginIndex]!;
  const updatedPluginConfig: PluginConfig = {
    ...currentPluginConfig,
    package: {
      ...(currentPluginConfig.package ?? {}),
      path: nextContributions.pluginConfig.package!.path,
      source: nextContributions.pluginConfig.package!.source,
    },
  };
  const plugins = [...config.plugins!];
  plugins[pluginIndex] = updatedPluginConfig;

  const endpointUpdate = reconcilePluginEndpoints({
    current: config.endpoints,
    pluginId: plugin.manifest.id,
    previousDefaults: previousContributions?.endpoints ?? [],
    nextDefaults: nextContributions.endpoints,
  });
  const mcpServerUpdate = reconcilePluginMcpServers({
    current: config.tools?.mcp?.servers ?? [],
    previousDefaults: previousContributions?.mcpServers ?? [],
    nextDefaults: nextContributions.mcpServers,
  });
  const updatedConfig: AppConfig = {
    ...config,
    plugins,
    endpoints: endpointUpdate.items,
    tools: withMcpServers(config.tools, mcpServerUpdate.items),
  };
  const validatedConfig = validatePluginUpdatedConfig(updatedConfig, plugin.manifest.id);

  return {
    config: validatedConfig,
    changes: {
      previousVersion: currentPluginConfig.package?.source?.version,
      nextVersion: plugin.manifest.version,
      previousManifestHash: currentPluginConfig.package?.source?.manifestHash,
      nextManifestHash: plugin.manifestHash,
      addedEndpointIds: endpointUpdate.addedIds,
      updatedEndpointIds: endpointUpdate.updatedIds,
      removedEndpointIds: endpointUpdate.removedIds,
      preservedEndpointIds: endpointUpdate.preservedIds,
      addedMcpServerIds: mcpServerUpdate.addedIds,
      updatedMcpServerIds: mcpServerUpdate.updatedIds,
      removedMcpServerIds: mcpServerUpdate.removedIds,
      preservedMcpServerIds: mcpServerUpdate.preservedIds,
    },
  };
}

function createPluginConfigContributions(
  config: AppConfig,
  plugin: DiscoveredPluginManifest,
  configPath: string,
): PluginConfigContributions {
  const pluginTemplateContext = createPluginConfigTemplateContext(config, configPath, plugin);

  return {
    pluginConfig: {
      id: plugin.manifest.id,
      enabled: true,
      package: {
        path: plugin.rootDir,
        source: {
          version: plugin.manifest.version,
          manifestHash: plugin.manifestHash,
        },
      },
    },
    endpoints: (plugin.manifest.endpoints ?? []).map((endpoint) => ({
      id: endpoint.id,
      type: "file",
      enabled: true,
      pluginId: plugin.manifest.id,
      ...(endpoint.routing ? { routing: endpoint.routing } : {}),
      ...(endpoint.ingress ? { ingress: endpoint.ingress } : {}),
      response: endpoint.response,
    })),
    mcpServers: (plugin.manifest.mcpServers ?? []).map((server) => ({
      id: server.id,
      command: resolvePluginMcpCommand(renderPluginConfigTemplate(server.command, pluginTemplateContext)),
      ...(server.args ? { args: server.args.map((arg) => renderPluginConfigTemplate(arg, pluginTemplateContext)) } : {}),
      ...(server.inheritEnv
        ? { inheritEnv: server.inheritEnv.map((entry) => renderPluginConfigTemplate(entry, pluginTemplateContext)) }
        : {}),
      ...(server.env ? { env: mapRecordValues(server.env, (value) => renderPluginConfigTemplate(value, pluginTemplateContext)) } : {}),
      ...(server.cwd ? { cwd: resolvePluginConfigPath(server.cwd, pluginTemplateContext) } : {}),
    })),
  };
}

interface PluginConfigTemplateContext {
  configPath: string;
  configDir: string;
  dataRoot: string;
  pluginId: string;
  pluginRoot: string;
}

function createPluginConfigTemplateContext(
  config: AppConfig,
  configPath: string,
  plugin: DiscoveredPluginManifest,
): PluginConfigTemplateContext {
  const configDir = dirname(configPath);
  return {
    configPath,
    configDir,
    dataRoot: resolvePathRelativeToConfig(config.paths.dataRoot, configDir),
    pluginId: plugin.manifest.id,
    pluginRoot: plugin.rootDir,
  };
}

function resolvePluginConfigPath(value: string, context: PluginConfigTemplateContext): string {
  const rendered = renderPluginConfigTemplate(value, context);
  if (rendered === value && !value.includes("{{")) {
    return resolvePathRelativeToConfig(value, context.pluginRoot);
  }
  return rendered;
}

function renderPluginConfigTemplate(value: string, context: PluginConfigTemplateContext): string {
  return value
    .replaceAll("{{config.path}}", context.configPath)
    .replaceAll("{{config.dir}}", context.configDir)
    .replaceAll("{{paths.dataRoot}}", context.dataRoot)
    .replaceAll("{{plugin.id}}", context.pluginId)
    .replaceAll("{{plugin.rootDir}}", context.pluginRoot);
}

function resolvePluginMcpCommand(command: string): string {
  return command === "node" ? process.execPath : command;
}

function mapRecordValues(
  record: Record<string, string>,
  mapValue: (value: string) => string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mapValue(value)]));
}

interface ReconcileResult<T> {
  items: T[];
  addedIds: string[];
  updatedIds: string[];
  removedIds: string[];
  preservedIds: string[];
}

function reconcilePluginEndpoints(options: {
  current: EndpointConfig[];
  pluginId: string;
  previousDefaults: FileEndpointConfig[];
  nextDefaults: FileEndpointConfig[];
}): ReconcileResult<EndpointConfig> {
  const previousById = mapById(options.previousDefaults);
  const nextById = mapById(options.nextDefaults);
  const existingIds = new Set(options.current.map((endpoint) => endpoint.id));
  const seenNextIds = new Set<string>();
  const result: ReconcileResult<EndpointConfig> = {
    items: [],
    addedIds: [],
    updatedIds: [],
    removedIds: [],
    preservedIds: [],
  };

  for (const endpoint of options.current) {
    const previousDefault = previousById.get(endpoint.id);
    const nextDefault = nextById.get(endpoint.id);
    if (nextDefault) {
      seenNextIds.add(nextDefault.id);
    }

    if (!isFileEndpointForPlugin(endpoint, options.pluginId) && !previousDefault) {
      result.items.push(endpoint);
      continue;
    }

    if (!nextDefault) {
      if (previousDefault && deepEqual(endpoint, previousDefault)) {
        result.removedIds.push(endpoint.id);
        continue;
      }

      result.items.push(endpoint);
      if (previousDefault) {
        result.preservedIds.push(endpoint.id);
      }
      continue;
    }

    if (!previousDefault) {
      result.items.push(endpoint);
      result.preservedIds.push(endpoint.id);
      continue;
    }

    if (!deepEqual(endpoint, previousDefault)) {
      result.items.push(endpoint);
      result.preservedIds.push(endpoint.id);
      continue;
    }

    result.items.push(nextDefault);
    if (!deepEqual(previousDefault, nextDefault)) {
      result.updatedIds.push(endpoint.id);
    }
  }

  for (const nextDefault of options.nextDefaults) {
    if (seenNextIds.has(nextDefault.id)) {
      continue;
    }
    if (existingIds.has(nextDefault.id)) {
      throw new Error(`Endpoint "${nextDefault.id}" already exists in the config.`);
    }

    result.items.push(nextDefault);
    result.addedIds.push(nextDefault.id);
  }

  return dedupePreservedIds(result);
}

function reconcilePluginMcpServers(options: {
  current: McpServerConfig[];
  previousDefaults: McpServerConfig[];
  nextDefaults: McpServerConfig[];
}): ReconcileResult<McpServerConfig> {
  const previousById = mapById(options.previousDefaults);
  const nextById = mapById(options.nextDefaults);
  const existingIds = new Set(options.current.map((server) => server.id));
  const seenNextIds = new Set<string>();
  const result: ReconcileResult<McpServerConfig> = {
    items: [],
    addedIds: [],
    updatedIds: [],
    removedIds: [],
    preservedIds: [],
  };

  for (const server of options.current) {
    const previousDefault = previousById.get(server.id);
    const nextDefault = nextById.get(server.id);
    if (nextDefault) {
      seenNextIds.add(nextDefault.id);
    }

    if (!previousDefault && !nextDefault) {
      result.items.push(server);
      continue;
    }

    if (!nextDefault) {
      if (previousDefault && deepEqual(server, previousDefault)) {
        result.removedIds.push(server.id);
        continue;
      }

      result.items.push(server);
      result.preservedIds.push(server.id);
      continue;
    }

    if (!previousDefault) {
      result.items.push(server);
      result.preservedIds.push(server.id);
      continue;
    }

    if (!deepEqual(server, previousDefault)) {
      result.items.push(server);
      result.preservedIds.push(server.id);
      continue;
    }

    result.items.push(nextDefault);
    if (!deepEqual(previousDefault, nextDefault)) {
      result.updatedIds.push(server.id);
    }
  }

  for (const nextDefault of options.nextDefaults) {
    if (seenNextIds.has(nextDefault.id)) {
      continue;
    }
    if (existingIds.has(nextDefault.id)) {
      throw new Error(`MCP server "${nextDefault.id}" already exists in the config.`);
    }

    result.items.push(nextDefault);
    result.addedIds.push(nextDefault.id);
  }

  return dedupePreservedIds(result);
}

function withMcpServers(tools: AppConfig["tools"], servers: McpServerConfig[]): AppConfig["tools"] {
  if (servers.length > 0) {
    return {
      ...(tools ?? {}),
      mcp: {
        ...(tools?.mcp?.inheritEnv ? { inheritEnv: tools.mcp.inheritEnv } : {}),
        servers,
      },
    };
  }

  if (!tools) {
    return undefined;
  }

  const rest = { ...tools };
  delete rest.mcp;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function validatePluginUpdatedConfig(config: AppConfig, pluginId: string): AppConfig {
  const result = appConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      [
        `Plugin "${pluginId}" produced an invalid config update.`,
        ...result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
      ].join("\n"),
    );
  }

  return result.data;
}

function isFileEndpointForPlugin(endpoint: EndpointConfig, pluginId: string): endpoint is FileEndpointConfig {
  return endpoint.type === "file" && endpoint.pluginId === pluginId;
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dedupePreservedIds<T>(result: ReconcileResult<T>): ReconcileResult<T> {
  return {
    ...result,
    preservedIds: Array.from(new Set(result.preservedIds)),
  };
}

export async function findConfiguredPluginManifest(options: {
  config: AppConfig;
  configPath: string;
  pluginId: string;
}): Promise<DiscoveredPluginManifest> {
  const configuredPlugin = (options.config.plugins ?? []).find((plugin) => plugin.id === options.pluginId);
  if (!configuredPlugin) {
    throw new Error(`Plugin "${options.pluginId}" is not configured.`);
  }

  if (!configuredPlugin.package?.path) {
    throw new Error(`Plugin "${options.pluginId}" does not have a package path in the config.`);
  }

  const pluginRoot = resolvePathRelativeToConfig(configuredPlugin.package.path, dirname(options.configPath));
  const discovered = await readPluginManifest(pluginRoot, join(pluginRoot, PLUGIN_MANIFEST_FILE));
  if ("issue" in discovered) {
    throw new Error(`Could not read configured plugin "${options.pluginId}": ${discovered.issue.message}`);
  }

  return discovered.plugin;
}

function assertPluginCanBeInstalled(config: AppConfig, plugin: DiscoveredPluginManifest): void {
  if ((config.plugins ?? []).some((entry) => entry.id === plugin.manifest.id)) {
    throw new Error(
      `Plugin "${plugin.manifest.id}" is already configured.\nRe-run with --services-only to reinstall plugin services.`,
    );
  }

  const endpointIds = new Set(config.endpoints.map((endpoint: EndpointConfig) => endpoint.id));
  for (const endpoint of plugin.manifest.endpoints ?? []) {
    if (endpointIds.has(endpoint.id)) {
      throw new Error(`Endpoint "${endpoint.id}" already exists in the config.`);
    }
  }

  const mcpServerIds = new Set(config.tools?.mcp?.servers.map((server) => server.id) ?? []);
  for (const server of plugin.manifest.mcpServers ?? []) {
    if (mcpServerIds.has(server.id)) {
      throw new Error(`MCP server "${server.id}" already exists in the config.`);
    }
  }
}
