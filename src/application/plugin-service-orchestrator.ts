import type { AppConfig } from "../config/types.js";
import type { DiscoveredPluginManifest } from "../plugins/discovery.js";
import { installPluginServices, type PluginServiceInstallDependencies } from "./plugin-service-installer.js";
import { findConfiguredPluginManifest } from "./plugin-config-installer.js";
import type { InspectPluginOptions } from "./plugin-discovery-service.js";

export interface PluginServiceOrchestratorDependencies extends PluginServiceInstallDependencies {
  env?: NodeJS.ProcessEnv;
}

export function createPluginServiceOrchestrator(dependencies: PluginServiceOrchestratorDependencies) {
  return {
    async installForConfiguredPlugin(options: {
      config: AppConfig;
      configPath: string;
      pluginId: string;
      root?: string;
      force?: boolean;
      findPluginOrThrow: (options: InspectPluginOptions) => Promise<DiscoveredPluginManifest>;
      writeOutput: (text: string) => void;
    }): Promise<DiscoveredPluginManifest> {
      const plugin = options.root
        ? await options.findPluginOrThrow({ id: options.pluginId, root: options.root })
        : await findConfiguredPluginManifest({
            config: options.config,
            configPath: options.configPath,
            pluginId: options.pluginId,
          });

      await installPluginServices({
        config: options.config,
        configPath: options.configPath,
        plugin,
        force: options.force,
        dependencies: {
          env: dependencies.env,
          platform: dependencies.platform,
          homeDir: dependencies.homeDir,
          uid: dependencies.uid,
          installer: dependencies.installer,
          setupRunner: dependencies.setupRunner,
          writeOutput: options.writeOutput,
        },
      });

      return plugin;
    },

    async installForPlugin(options: {
      config: AppConfig;
      configPath: string;
      plugin: DiscoveredPluginManifest;
      force?: boolean;
      writeOutput: (text: string) => void;
    }): Promise<void> {
      await installPluginServices({
        config: options.config,
        configPath: options.configPath,
        plugin: options.plugin,
        force: options.force,
        dependencies: {
          env: dependencies.env,
          platform: dependencies.platform,
          homeDir: dependencies.homeDir,
          uid: dependencies.uid,
          installer: dependencies.installer,
          setupRunner: dependencies.setupRunner,
          writeOutput: options.writeOutput,
        },
      });
    },
  };
}
