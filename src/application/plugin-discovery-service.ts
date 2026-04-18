import { delimiter, resolve } from "node:path";
import {
  discoverPluginManifests,
  type DiscoveredPluginManifest,
  type PluginDiscoveryResult,
} from "../plugins/discovery.js";
import { renderPluginDetails, renderPluginListOutput } from "./plugin-output.js";

export interface PluginUseCaseOptions {
  root?: string;
}

export interface InspectPluginOptions extends PluginUseCaseOptions {
  id: string;
}

export interface PluginDiscoveryServiceDependencies {
  env?: NodeJS.ProcessEnv;
  discoverPluginManifests?: (roots: string[]) => Promise<PluginDiscoveryResult>;
}

export function createPluginDiscoveryService(dependencies: PluginDiscoveryServiceDependencies = {}) {
  const discover = dependencies.discoverPluginManifests ?? discoverPluginManifests;

  return {
    async listPlugins(options: PluginUseCaseOptions = {}): Promise<string> {
      const result = await discover(getPluginSearchRoots(options, dependencies.env));
      return renderPluginListOutput({ plugins: result.plugins, issues: result.issues });
    },

    async inspectPlugin(options: InspectPluginOptions): Promise<string> {
      const plugin = await findPluginOrThrow(options, discover, dependencies.env);
      return renderPluginDetails(plugin);
    },

    async findPlugin(options: InspectPluginOptions): Promise<DiscoveredPluginManifest | undefined> {
      const result = await discover(getPluginSearchRoots(options, dependencies.env));
      return result.plugins.find((candidate) => candidate.manifest.id === options.id);
    },

    async findPluginOrThrow(options: InspectPluginOptions): Promise<DiscoveredPluginManifest> {
      return findPluginOrThrow(options, discover, dependencies.env);
    },
  };
}

export async function findPluginOrThrow(
  options: InspectPluginOptions,
  discover: (roots: string[]) => Promise<PluginDiscoveryResult> = discoverPluginManifests,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiscoveredPluginManifest> {
  const result = await discover(getPluginSearchRoots(options, env));
  const plugin = result.plugins.find((candidate) => candidate.manifest.id === options.id);
  if (!plugin) {
    const known = result.plugins.map((candidate) => candidate.manifest.id).sort();
    throw new Error(
      `Plugin "${options.id}" was not found.` +
        (known.length > 0 ? ` Known plugins: ${known.map((id) => `"${id}"`).join(", ")}.` : ""),
    );
  }

  return plugin;
}

export function getPluginSearchRoots(options: PluginUseCaseOptions = {}, env: NodeJS.ProcessEnv = process.env): string[] {
  if (options.root) {
    return [resolve(options.root)];
  }

  return splitPluginPath(env.IMP_PLUGIN_PATH);
}

function splitPluginPath(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value.split(delimiter).filter((entry) => entry.length > 0);
}
