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

export function installPluginIntoConfig(config: AppConfig, plugin: DiscoveredPluginManifest): AppConfig {
  assertPluginCanBeInstalled(config, plugin);

  const pluginConfig: PluginConfig = {
    id: plugin.manifest.id,
    enabled: true,
    package: {
      path: plugin.rootDir,
      source: {
        version: plugin.manifest.version,
        manifestHash: plugin.manifestHash,
      },
    },
  };
  const endpointConfigs: FileEndpointConfig[] = (plugin.manifest.endpoints ?? []).map((endpoint) => ({
    id: endpoint.id,
    type: "file",
    enabled: true,
    pluginId: plugin.manifest.id,
    ...(endpoint.routing ? { routing: endpoint.routing } : {}),
    ...(endpoint.ingress ? { ingress: endpoint.ingress } : {}),
    response: endpoint.response,
  }));

  const updatedConfig: AppConfig = {
    ...config,
    plugins: [...(config.plugins ?? []), pluginConfig],
    endpoints: [...config.endpoints, ...endpointConfigs],
  };
  const result = appConfigSchema.safeParse(updatedConfig);
  if (!result.success) {
    throw new Error(
      [
        `Plugin "${plugin.manifest.id}" produced an invalid config update.`,
        ...result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
      ].join("\n"),
    );
  }

  return result.data;
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
}
