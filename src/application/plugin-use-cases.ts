import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  createPluginConfigInstaller,
  installPluginIntoConfig,
  updatePluginInConfig,
} from "./plugin-config-installer.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import {
  createPluginDiscoveryService,
  getPluginSearchRoots,
  type InspectPluginOptions,
  type PluginUseCaseOptions,
} from "./plugin-discovery-service.js";
import type { AppConfig, PluginConfig } from "../config/types.js";
import type { DiscoveredPluginManifest, PluginDiscoveryResult } from "../plugins/discovery.js";
import {
  createPluginPackageInstaller,
  getPluginPackageStoreRoot,
  parseNpmPackageName,
  type PluginPackageInstaller,
  tryParseNpmPackageName,
} from "./plugin-package-installer.js";
import { diagnoseConfiguredPlugin, renderPluginDiagnostic } from "./plugin-diagnostics.js";
import {
  renderPluginDetails,
  renderPluginInstallSummary,
  renderPluginListOutput,
  renderPluginUpdateSummary,
} from "./plugin-output.js";
import { createPluginServiceOrchestrator } from "./plugin-service-orchestrator.js";
import { findConfiguredPluginManifest } from "./plugin-config-installer.js";
import { findPluginOrThrow } from "./plugin-discovery-service.js";
import type { PluginServiceInstallDependencies } from "./plugin-service-installer.js";

export type { InspectPluginOptions, PluginUseCaseOptions };

export interface ListPluginOptions extends PluginUseCaseOptions {
  configPath?: string;
}

export interface InstallPluginOptions extends InspectPluginOptions {
  configPath?: string;
  autoStartServices?: boolean;
  servicesOnly?: boolean;
  force?: boolean;
}

export interface UpdatePluginOptions extends InspectPluginOptions {
  configPath?: string;
  autoStartServices?: boolean;
  force?: boolean;
}

export interface PluginUseCaseDependencies extends PluginServiceInstallDependencies {
  writeOutput?: (text: string) => void;
  env?: NodeJS.ProcessEnv;
  discoverConfigPath?: typeof discoverConfigPath;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
  installPackage?: PluginPackageInstaller;
}

export function createPluginUseCases(dependencies: PluginUseCaseDependencies = {}) {
  const writeOutput = dependencies.writeOutput ?? ((text: string) => console.log(text));
  const discovery = createPluginDiscoveryService({
    env: dependencies.env,
  });
  const configInstaller = createPluginConfigInstaller({
    discoverConfigPath: dependencies.discoverConfigPath,
    readTextFile: dependencies.readTextFile,
    writeTextFile: dependencies.writeTextFile,
  });
  const packageInstaller = createPluginPackageInstaller({
    env: dependencies.env,
    installPackage: dependencies.installPackage,
  });
  const services = createPluginServiceOrchestrator({
    env: dependencies.env,
    platform: dependencies.platform,
    setupPlatform: dependencies.setupPlatform,
    homeDir: dependencies.homeDir,
    uid: dependencies.uid,
    installer: dependencies.installer,
    setupRunner: dependencies.setupRunner,
  });

  return {
    async listPlugins(options: ListPluginOptions = {}): Promise<void> {
      const configured = await discoverConfiguredPluginsForList(configInstaller, options);
      const local = await discovery.discoverPlugins(options);
      writeOutput(renderPluginListOutput(mergePluginDiscoveryResults(configured, local)));
    },

    async inspectPlugin(options: InspectPluginOptions): Promise<void> {
      writeOutput(renderPluginDetails(await resolveInspectablePlugin({
        options,
        configInstaller,
        discovery,
      })));
    },

    async installPlugin(options: InstallPluginOptions): Promise<void> {
      const { configPath, config } = await configInstaller.readValidatedConfig({
        configPath: options.configPath,
      });

      if (options.servicesOnly) {
        const plugin = await services.installForConfiguredPlugin({
          config,
          configPath,
          pluginId: options.id,
          root: options.root,
          force: options.force,
          findPluginOrThrow: discovery.findPluginOrThrow,
          writeOutput,
        });
        if (plugin.manifest.init?.postInstallMessage) {
          writeOutput(plugin.manifest.init.postInstallMessage);
        }
        return;
      }

      const plugin = await resolveInstallablePlugin({
        options,
        config,
        configPath,
        discovery,
        packageInstaller,
        writeOutput,
      });
      const updatedConfig = installPluginIntoConfig(config, plugin, configPath);
      await configInstaller.writeConfig(configPath, updatedConfig);
      for (const line of renderPluginInstallSummary({
        pluginId: plugin.manifest.id,
        configPath,
        endpointIds: (plugin.manifest.endpoints ?? []).map((endpoint) => endpoint.id),
        mcpServerIds: (plugin.manifest.mcpServers ?? []).map((server) => server.id),
      })) {
        writeOutput(line);
      }
      if (shouldInstallPluginServices(plugin, options.autoStartServices)) {
        await services.installForPlugin({
          config: updatedConfig,
          configPath,
          plugin,
          force: options.force,
          writeOutput,
        });
      }
      if (plugin.manifest.init?.postInstallMessage) {
        writeOutput(plugin.manifest.init.postInstallMessage);
      }
    },

    async updatePlugin(options: UpdatePluginOptions): Promise<void> {
      const { configPath, config } = await configInstaller.readValidatedConfig({
        configPath: options.configPath,
      });
      const previousPlugin = await findPreviousPluginForUpdate({
        config,
        configPath,
        updateTarget: options.id,
      });
      const plugin = await resolveUpdatePlugin({
        options,
        config,
        configPath,
        previousPlugin,
        discovery,
        packageInstaller,
        writeOutput,
      });
      const currentPlugin = previousPlugin?.plugin.manifest.id === plugin.manifest.id
        ? previousPlugin.plugin
        : await tryFindConfiguredPluginManifest({
            config,
            configPath,
            pluginId: plugin.manifest.id,
          });
      const result = updatePluginInConfig(config, plugin, configPath, currentPlugin);
      await configInstaller.writeConfig(configPath, result.config);
      for (const line of renderPluginUpdateSummary({
        pluginId: plugin.manifest.id,
        configPath,
        changes: result.changes,
      })) {
        writeOutput(line);
      }
      if (shouldInstallPluginServices(plugin, options.autoStartServices)) {
        await services.installForPlugin({
          config: result.config,
          configPath,
          plugin,
          force: options.force,
          writeOutput,
        });
      }
      if (plugin.manifest.init?.postInstallMessage) {
        writeOutput(plugin.manifest.init.postInstallMessage);
      }
    },

    async doctorPlugin(options: { configPath?: string; id: string }): Promise<void> {
      const { configPath, config } = await configInstaller.readValidatedConfig({
        configPath: options.configPath,
      });
      let plugin;
      let manifestError: unknown;
      try {
        plugin = await findConfiguredPluginManifest({
          config,
          configPath,
          pluginId: options.id,
        });
      } catch (error) {
        manifestError = error;
      }
      writeOutput(renderPluginDiagnostic(await diagnoseConfiguredPlugin({
        config,
        configPath,
        pluginId: options.id,
        plugin,
        manifestError,
      })));
    },

    async statusPlugin(options: { configPath?: string; id: string }): Promise<void> {
      const { configPath, config } = await configInstaller.readValidatedConfig({
        configPath: options.configPath,
      });
      let plugin;
      let manifestError: unknown;
      try {
        plugin = await findConfiguredPluginManifest({
          config,
          configPath,
          pluginId: options.id,
        });
      } catch (error) {
        manifestError = error;
      }
      const result = await diagnoseConfiguredPlugin({
        config,
        configPath,
        pluginId: options.id,
        plugin,
        manifestError,
      });
      writeOutput(`Plugin ${result.pluginId}: ${result.ok ? "ok" : "issues found"}`);
    },
  };
}

async function resolveInstallablePlugin(options: {
  options: InstallPluginOptions;
  config: Parameters<typeof installPluginIntoConfig>[0];
  configPath: string;
  discovery: ReturnType<typeof createPluginDiscoveryService>;
  packageInstaller: ReturnType<typeof createPluginPackageInstaller>;
  writeOutput: (text: string) => void;
}) {
  if (options.options.root) {
    return options.discovery.findPluginOrThrow(options.options);
  }

  const localPlugin = await options.discovery.findPlugin(options.options);
  if (localPlugin) {
    return localPlugin;
  }

  return options.packageInstaller.installFromPackageSpec({
    packageSpec: options.options.id,
    config: options.config,
    configPath: options.configPath,
    writeOutput: options.writeOutput,
  });
}

function shouldInstallPluginServices(plugin: DiscoveredPluginManifest, autoStartServices: boolean | undefined): boolean {
  return autoStartServices !== false && (plugin.manifest.services ?? []).some((service) => service.autoStart !== false);
}

async function resolveUpdatePlugin(options: {
  options: UpdatePluginOptions;
  config: AppConfig;
  configPath: string;
  previousPlugin?: PreviousPluginMatch;
  discovery: ReturnType<typeof createPluginDiscoveryService>;
  packageInstaller: ReturnType<typeof createPluginPackageInstaller>;
  writeOutput: (text: string) => void;
}): Promise<DiscoveredPluginManifest> {
  if (options.options.root) {
    return options.discovery.findPluginOrThrow(options.options);
  }

  if (options.previousPlugin) {
    if (options.previousPlugin.matchedBy === "package-spec") {
      return options.packageInstaller.installFromPackageSpec({
        packageSpec: options.options.id,
        config: options.config,
        configPath: options.configPath,
        writeOutput: options.writeOutput,
      });
    }

    const packageSpec = await inferConfiguredPackageUpdateSpec({
      config: options.config,
      configPath: options.configPath,
      plugin: options.previousPlugin.plugin,
    });
    if (!packageSpec) {
      return options.previousPlugin.plugin;
    }

    return options.packageInstaller.installFromPackageSpec({
      packageSpec,
      config: options.config,
      configPath: options.configPath,
      writeOutput: options.writeOutput,
    });
  }

  const localPlugin = await options.discovery.findPlugin(options.options);
  if (localPlugin) {
    return localPlugin;
  }

  return options.packageInstaller.installFromPackageSpec({
    packageSpec: options.options.id,
    config: options.config,
    configPath: options.configPath,
    writeOutput: options.writeOutput,
  });
}

async function resolveInspectablePlugin(options: {
  options: InspectPluginOptions;
  configInstaller: ReturnType<typeof createPluginConfigInstaller>;
  discovery: ReturnType<typeof createPluginDiscoveryService>;
}): Promise<DiscoveredPluginManifest> {
  if (options.options.root) {
    return options.discovery.findPluginOrThrow(options.options);
  }

  const localPlugin = await options.discovery.findPlugin(options.options);
  if (localPlugin) {
    return localPlugin;
  }

  const configured = await readOptionalValidatedConfig(options.configInstaller, options.options.configPath);
  if (configured) {
    return findConfiguredPluginManifest({
      config: configured.config,
      configPath: configured.configPath,
      pluginId: options.options.id,
    });
  }

  return options.discovery.findPluginOrThrow(options.options);
}

async function discoverConfiguredPluginsForList(
  configInstaller: ReturnType<typeof createPluginConfigInstaller>,
  options: ListPluginOptions,
): Promise<PluginDiscoveryResult> {
  if (options.root && !options.configPath) {
    return emptyPluginDiscoveryResult();
  }

  const configured = await readOptionalValidatedConfig(configInstaller, options.configPath);
  if (!configured) {
    return emptyPluginDiscoveryResult();
  }

  const plugins: DiscoveredPluginManifest[] = [];
  const issues: PluginDiscoveryResult["issues"] = [];
  for (const pluginConfig of configured.config.plugins ?? []) {
    if (!pluginConfig.package?.path) {
      issues.push({
        path: pluginConfig.id,
        message: `Plugin "${pluginConfig.id}" does not have a package path in the config.`,
      });
      continue;
    }

    try {
      plugins.push(await findConfiguredPluginManifest({
        config: configured.config,
        configPath: configured.configPath,
        pluginId: pluginConfig.id,
      }));
    } catch (error) {
      issues.push({
        path: pluginConfig.package.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { plugins, issues };
}

async function readOptionalValidatedConfig(
  configInstaller: ReturnType<typeof createPluginConfigInstaller>,
  configPath?: string,
): Promise<{ configPath: string; config: AppConfig } | undefined> {
  try {
    return await configInstaller.readValidatedConfig({ configPath });
  } catch (error) {
    if (!configPath && error instanceof Error && error.message.startsWith("No config file found.")) {
      return undefined;
    }
    throw error;
  }
}

function mergePluginDiscoveryResults(
  configured: PluginDiscoveryResult,
  local: PluginDiscoveryResult,
): PluginDiscoveryResult {
  const pluginsById = new Map<string, DiscoveredPluginManifest>();
  for (const plugin of local.plugins) {
    pluginsById.set(plugin.manifest.id, plugin);
  }
  for (const plugin of configured.plugins) {
    pluginsById.set(plugin.manifest.id, plugin);
  }

  return {
    plugins: [...pluginsById.values()].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id)),
    issues: [...configured.issues, ...local.issues],
  };
}

function emptyPluginDiscoveryResult(): PluginDiscoveryResult {
  return {
    plugins: [],
    issues: [],
  };
}

interface PreviousPluginMatch {
  plugin: DiscoveredPluginManifest;
  matchedBy: "plugin-id" | "package-spec";
}

async function findPreviousPluginForUpdate(options: {
  config: AppConfig;
  configPath: string;
  updateTarget: string;
}): Promise<PreviousPluginMatch | undefined> {
  const plugin = await tryFindConfiguredPluginManifest({
    config: options.config,
    configPath: options.configPath,
    pluginId: options.updateTarget,
  });
  if (plugin) {
    return {
      plugin,
      matchedBy: "plugin-id",
    };
  }

  const packageName = tryParseNpmPackageName(options.updateTarget);
  if (!packageName) {
    return undefined;
  }

  for (const pluginConfig of options.config.plugins ?? []) {
    const configuredPlugin = await tryFindConfiguredPluginManifest({
      config: options.config,
      configPath: options.configPath,
      pluginId: pluginConfig.id,
    });
    if (!configuredPlugin) {
      continue;
    }

    if (await readConfiguredPackageName(configuredPlugin) === packageName) {
      return {
        plugin: configuredPlugin,
        matchedBy: "package-spec",
      };
    }
  }

  return undefined;
}

async function tryFindConfiguredPluginManifest(options: {
  config: AppConfig;
  configPath: string;
  pluginId: string;
}): Promise<DiscoveredPluginManifest | undefined> {
  try {
    return await findConfiguredPluginManifest(options);
  } catch {
    return undefined;
  }
}

async function readConfiguredPackageName(plugin: DiscoveredPluginManifest): Promise<string | undefined> {
  try {
    const packageJson = JSON.parse(await readFile(join(plugin.rootDir, "package.json"), "utf8")) as {
      name?: unknown;
    };
    return typeof packageJson.name === "string" && packageJson.name.length > 0 ? packageJson.name : undefined;
  } catch {
    return undefined;
  }
}

async function inferConfiguredPackageUpdateSpec(options: {
  config: AppConfig;
  configPath: string;
  plugin: DiscoveredPluginManifest;
}): Promise<string | undefined> {
  const pluginConfig = findConfiguredPluginConfig(options.config, options.plugin.manifest.id);
  if (!pluginConfig?.package?.path) {
    return undefined;
  }

  const packageStoreModulesRoot = join(getPluginPackageStoreRoot(options.config, options.configPath), "node_modules");
  if (!isPathInside(options.plugin.rootDir, packageStoreModulesRoot)) {
    return undefined;
  }

  return readConfiguredPackageName(options.plugin);
}

function findConfiguredPluginConfig(config: AppConfig, pluginId: string): PluginConfig | undefined {
  return (config.plugins ?? []).find((plugin) => plugin.id === pluginId);
}

function isPathInside(path: string, parent: string): boolean {
  const pathRelativeToParent = relative(parent, path);
  return pathRelativeToParent.length > 0 && !pathRelativeToParent.startsWith("..") && !isAbsolute(pathRelativeToParent);
}

export {
  findConfiguredPluginManifest,
  findPluginOrThrow,
  getPluginPackageStoreRoot,
  getPluginSearchRoots,
  installPluginIntoConfig,
  parseNpmPackageName,
  tryParseNpmPackageName,
};
