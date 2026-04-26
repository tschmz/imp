import { createPluginConfigInstaller, installPluginIntoConfig } from "./plugin-config-installer.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import {
  createPluginDiscoveryService,
  getPluginSearchRoots,
  type InspectPluginOptions,
  type PluginUseCaseOptions,
} from "./plugin-discovery-service.js";
import {
  createPluginPackageInstaller,
  getPluginPackageStoreRoot,
  parseNpmPackageName,
  type PluginPackageInstaller,
  tryParseNpmPackageName,
} from "./plugin-package-installer.js";
import { diagnoseConfiguredPlugin, renderPluginDiagnostic } from "./plugin-diagnostics.js";
import { renderPluginInstallSummary } from "./plugin-output.js";
import { createPluginServiceOrchestrator } from "./plugin-service-orchestrator.js";
import { findConfiguredPluginManifest } from "./plugin-config-installer.js";
import { findPluginOrThrow } from "./plugin-discovery-service.js";
import type { PluginServiceInstallDependencies } from "./plugin-service-installer.js";

export type { InspectPluginOptions, PluginUseCaseOptions };

export interface InstallPluginOptions extends InspectPluginOptions {
  configPath?: string;
  autoStartServices?: boolean;
  servicesOnly?: boolean;
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
    homeDir: dependencies.homeDir,
    uid: dependencies.uid,
    installer: dependencies.installer,
    setupRunner: dependencies.setupRunner,
  });

  return {
    async listPlugins(options: PluginUseCaseOptions = {}): Promise<void> {
      writeOutput(await discovery.listPlugins(options));
    },

    async inspectPlugin(options: InspectPluginOptions): Promise<void> {
      writeOutput(await discovery.inspectPlugin(options));
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
      if (options.autoStartServices !== false) {
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

export {
  findConfiguredPluginManifest,
  findPluginOrThrow,
  getPluginPackageStoreRoot,
  getPluginSearchRoots,
  installPluginIntoConfig,
  parseNpmPackageName,
  tryParseNpmPackageName,
};
