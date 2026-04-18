import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parseConfigJson } from "../config/config-json.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { appConfigSchema } from "../config/schema.js";
import type { AppConfig, EndpointConfig, PluginConfig, PluginEndpointConfig } from "../config/types.js";
import { discoverPluginManifests, readPluginManifest, type DiscoveredPluginManifest } from "../plugins/discovery.js";
import { PLUGIN_MANIFEST_FILE } from "../plugins/manifest.js";
import { installPluginServices, type PluginServiceInstallDependencies } from "./plugin-service-installer.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "../config/secret-value.js";

const execFileAsync = promisify(execFile);

export interface PluginUseCaseOptions {
  root?: string;
}

export interface InspectPluginOptions extends PluginUseCaseOptions {
  id: string;
}

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

export type PluginPackageInstaller = (options: {
  packageSpec: string;
  packageName?: string;
  storeRoot: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<{ packageRoot: string }>;

export function createPluginUseCases(dependencies: PluginUseCaseDependencies = {}) {
  const writeOutput = dependencies.writeOutput ?? ((text: string) => console.log(text));
  const discoverConfig = dependencies.discoverConfigPath ?? discoverConfigPath;
  const readText = dependencies.readTextFile ?? ((path: string) => readFile(path, "utf8"));
  const writeText = dependencies.writeTextFile ?? ((path: string, content: string) => writeFile(path, content, "utf8"));

  return {
    async listPlugins(options: PluginUseCaseOptions = {}): Promise<void> {
      const result = await discoverPluginManifests(getPluginSearchRoots(options, dependencies.env));
      const lines = result.plugins.map((plugin) => renderPluginListEntry(plugin));
      if (lines.length === 0) {
        lines.push("No plugins found.");
      }

      if (result.issues.length > 0) {
        lines.push("");
        lines.push("Issues:");
        lines.push(...result.issues.map((issue) => `- ${issue.path}: ${issue.message}`));
      }

      writeOutput(lines.join("\n"));
    },

    async inspectPlugin(options: InspectPluginOptions): Promise<void> {
      const result = await discoverPluginManifests(getPluginSearchRoots(options, dependencies.env));
      const plugin = result.plugins.find((candidate) => candidate.manifest.id === options.id);
      if (!plugin) {
        const known = result.plugins.map((candidate) => candidate.manifest.id).sort();
        throw new Error(
          `Plugin "${options.id}" was not found.` +
            (known.length > 0 ? ` Known plugins: ${known.map((id) => `"${id}"`).join(", ")}.` : ""),
        );
      }

      writeOutput(renderPluginDetails(plugin));
    },

    async installPlugin(options: InstallPluginOptions): Promise<void> {
      const { configPath } = await discoverConfig({
        cliConfigPath: options.configPath,
      });
      const rawConfig = await readText(configPath);
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

      if (options.servicesOnly) {
        const plugin = await installServicesForConfiguredPlugin({
          config: configResult.data,
          configPath,
          pluginId: options.id,
          root: options.root,
          force: options.force,
          dependencies,
          writeOutput,
        });
        if (plugin.manifest.init?.postInstallMessage) {
          writeOutput(plugin.manifest.init.postInstallMessage);
        }
        return;
      }

      const plugin = await resolveInstallablePlugin({
        options,
        config: configResult.data,
        configPath,
        dependencies,
        writeOutput,
      });
      const updatedConfig = installPluginIntoConfig(configResult.data, plugin);
      await writeText(configPath, `${JSON.stringify(updatedConfig, null, 2)}\n`);
      writeOutput(`Installed plugin "${plugin.manifest.id}" into ${configPath}`);
      if (plugin.manifest.endpoints?.length) {
        writeOutput(`Added endpoints: ${plugin.manifest.endpoints.map((endpoint) => endpoint.id).join(", ")}`);
      }
      if (options.autoStartServices !== false) {
        await installPluginServices({
          config: updatedConfig,
          configPath,
          plugin,
          force: options.force,
          dependencies: {
            env: dependencies.env,
            platform: dependencies.platform,
            homeDir: dependencies.homeDir,
            uid: dependencies.uid,
            installer: dependencies.installer,
            setupRunner: dependencies.setupRunner,
            writeOutput,
          },
        });
      }
      if (plugin.manifest.init?.postInstallMessage) {
        writeOutput(plugin.manifest.init.postInstallMessage);
      }
    },
  };
}

export function installPluginIntoConfig(config: AppConfig, plugin: DiscoveredPluginManifest): AppConfig {
  assertPluginCanBeInstalled(config, plugin);

  const pluginConfig: PluginConfig = {
    id: plugin.manifest.id,
    enabled: true,
    package: {
      path: plugin.rootDir,
    },
  };
  const endpointConfigs: PluginEndpointConfig[] = (plugin.manifest.endpoints ?? []).map((endpoint) => ({
    id: endpoint.id,
    type: "plugin",
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

async function installServicesForConfiguredPlugin(options: {
  config: AppConfig;
  configPath: string;
  pluginId: string;
  root?: string;
  force?: boolean;
  dependencies: PluginUseCaseDependencies;
  writeOutput: (text: string) => void;
}): Promise<DiscoveredPluginManifest> {
  const plugin = await findConfiguredPluginManifest(options);
  await installPluginServices({
    config: options.config,
    configPath: options.configPath,
    plugin,
    force: options.force,
    dependencies: {
      env: options.dependencies.env,
      platform: options.dependencies.platform,
      homeDir: options.dependencies.homeDir,
      uid: options.dependencies.uid,
      installer: options.dependencies.installer,
      setupRunner: options.dependencies.setupRunner,
      writeOutput: options.writeOutput,
    },
  });
  return plugin;
}

async function findConfiguredPluginManifest(options: {
  config: AppConfig;
  configPath: string;
  pluginId: string;
  root?: string;
  dependencies: PluginUseCaseDependencies;
}): Promise<DiscoveredPluginManifest> {
  const configuredPlugin = (options.config.plugins ?? []).find((plugin) => plugin.id === options.pluginId);
  if (!configuredPlugin) {
    throw new Error(`Plugin "${options.pluginId}" is not configured.`);
  }

  if (options.root) {
    return findPluginOrThrow({ id: options.pluginId, root: options.root }, options.dependencies.env);
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

export function getPluginSearchRoots(
  options: PluginUseCaseOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (options.root) {
    return [resolve(options.root)];
  }

  return splitPluginPath(env.IMP_PLUGIN_PATH);
}

export function getPluginPackageStoreRoot(config: AppConfig, configPath: string): string {
  const configDir = dirname(configPath);
  const dataRoot = resolvePathRelativeToConfig(config.paths.dataRoot, configDir);
  return join(dataRoot, "plugins", "npm");
}

export function parseNpmPackageName(packageSpec: string): string {
  const normalized = packageSpec.startsWith("npm:") ? packageSpec.slice("npm:".length) : packageSpec;
  if (normalized.length === 0) {
    throw new Error("Plugin package spec must not be empty.");
  }

  if (isPackagePathSpec(normalized)) {
    throw new Error(`Package path specs do not encode a package name: ${packageSpec}`);
  }

  if (normalized.startsWith("@")) {
    const slashIndex = normalized.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(`Invalid npm package spec "${packageSpec}". Scoped packages must include a package name.`);
    }

    const versionIndex = normalized.indexOf("@", slashIndex + 1);
    return versionIndex === -1 ? normalized : normalized.slice(0, versionIndex);
  }

  const versionIndex = normalized.indexOf("@");
  return versionIndex === -1 ? normalized : normalized.slice(0, versionIndex);
}

export function tryParseNpmPackageName(packageSpec: string): string | undefined {
  try {
    return parseNpmPackageName(packageSpec);
  } catch {
    return undefined;
  }
}

async function findPluginOrThrow(
  options: InspectPluginOptions,
  env: NodeJS.ProcessEnv | undefined,
): Promise<DiscoveredPluginManifest> {
  const result = await discoverPluginManifests(getPluginSearchRoots(options, env));
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

async function resolveInstallablePlugin(options: {
  options: InstallPluginOptions;
  config: AppConfig;
  configPath: string;
  dependencies: PluginUseCaseDependencies;
  writeOutput: (text: string) => void;
}): Promise<DiscoveredPluginManifest> {
  if (options.options.root) {
    return findPluginOrThrow(options.options, options.dependencies.env);
  }

  const localPlugin = await findPlugin(options.options, options.dependencies.env);
  if (localPlugin) {
    return localPlugin;
  }

  return installPluginPackageAndReadManifest(options);
}

async function findPlugin(
  options: InspectPluginOptions,
  env: NodeJS.ProcessEnv | undefined,
): Promise<DiscoveredPluginManifest | undefined> {
  const result = await discoverPluginManifests(getPluginSearchRoots(options, env));
  return result.plugins.find((candidate) => candidate.manifest.id === options.id);
}

async function installPluginPackageAndReadManifest(options: {
  options: InstallPluginOptions;
  config: AppConfig;
  configPath: string;
  dependencies: PluginUseCaseDependencies;
  writeOutput: (text: string) => void;
}): Promise<DiscoveredPluginManifest> {
  const packageSpec = options.options.id;
  const normalizedPackageSpec = packageSpec.startsWith("npm:") ? packageSpec.slice("npm:".length) : packageSpec;
  const packageName = tryParseNpmPackageName(packageSpec);
  const storeRoot = getPluginPackageStoreRoot(options.config, options.configPath);
  const installPackage = options.dependencies.installPackage ?? installNpmPackage;

  const { packageRoot } = await installPackage({
    packageSpec: normalizedPackageSpec,
    packageName,
    storeRoot,
    env: options.dependencies.env,
  });
  options.writeOutput(`Installed plugin package "${packageSpec}" into ${storeRoot}`);

  const discovered = await readPluginManifest(packageRoot, join(packageRoot, PLUGIN_MANIFEST_FILE));
  if ("issue" in discovered) {
    throw new Error(
      `Installed package "${packageSpec}" does not contain a valid plugin manifest: ${discovered.issue.message}`,
    );
  }

  return discovered.plugin;
}

async function installNpmPackage(options: {
  packageSpec: string;
  packageName?: string;
  storeRoot: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ packageRoot: string }> {
  await ensurePackageStore(options.storeRoot);
  await execFileAsync("npm", ["install", options.packageSpec, "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: options.storeRoot,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });

  return {
    packageRoot: await resolveInstalledPackageRoot(options),
  };
}

async function ensurePackageStore(storeRoot: string): Promise<void> {
  await mkdir(storeRoot, { recursive: true });
  const packageJsonPath = join(storeRoot, "package.json");
  try {
    await access(packageJsonPath);
  } catch {
    await writeFile(
      packageJsonPath,
      `${JSON.stringify(
        {
          private: true,
          description: "imp managed plugin package store",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

async function resolveInstalledPackageRoot(options: {
  packageSpec: string;
  packageName?: string;
  storeRoot: string;
}): Promise<string> {
  if (options.packageName) {
    const packageRoot = join(options.storeRoot, "node_modules", ...options.packageName.split("/"));
    await access(join(packageRoot, PLUGIN_MANIFEST_FILE));
    return packageRoot;
  }

  const lockfilePath = join(options.storeRoot, "package-lock.json");
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8")) as {
    packages?: Record<string, { resolved?: string }>;
  };
  const packageEntry = Object.entries(lockfile.packages ?? {}).find(([path, entry]) => {
    return path.startsWith("node_modules/") && entry.resolved?.includes(basename(options.packageSpec));
  });
  if (!packageEntry) {
    throw new Error(`Could not resolve installed package root for "${options.packageSpec}".`);
  }

  const packageRoot = join(options.storeRoot, packageEntry[0]);
  await access(join(packageRoot, PLUGIN_MANIFEST_FILE));
  return packageRoot;
}

function isPackagePathSpec(packageSpec: string): boolean {
  return (
    packageSpec.startsWith(".") ||
    packageSpec.startsWith("/") ||
    packageSpec.startsWith("file:") ||
    packageSpec.endsWith(".tgz")
  );
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

function splitPluginPath(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value.split(delimiter).filter((entry) => entry.length > 0);
}

function renderPluginListEntry(plugin: DiscoveredPluginManifest): string {
  const description = plugin.manifest.description ? ` - ${plugin.manifest.description}` : "";
  return `${plugin.manifest.id}\t${plugin.manifest.name} ${plugin.manifest.version}${description}`;
}

function renderPluginDetails(plugin: DiscoveredPluginManifest): string {
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

  if (plugin.manifest.init?.configTemplate) {
    lines.push("");
    lines.push(`Config template: ${plugin.manifest.init.configTemplate}`);
  }

  return lines.join("\n");
}
