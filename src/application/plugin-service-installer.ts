import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config/types.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "../config/secret-value.js";
import { readPluginManifest, type DiscoveredPluginManifest } from "../plugins/discovery.js";
import type { PluginServiceManifest } from "../plugins/manifest.js";
import { PLUGIN_MANIFEST_FILE } from "../plugins/manifest.js";
import { installService, type ServiceInstaller } from "../service/install-service.js";
import type { ServicePlatformInput } from "../service/install-plan.js";

const execFileAsync = promisify(execFile);

export interface PluginServiceInstallDependencies {
  env?: NodeJS.ProcessEnv;
  platform?: ServicePlatformInput;
  setupPlatform?: ServicePlatformInput;
  homeDir?: string;
  uid?: number;
  installer?: ServiceInstaller;
  setupRunner?: PluginSetupRunner;
  writeOutput?: (text: string) => void;
}

export interface PluginSetupRunner {
  run(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<void>;
}

export async function installPluginServices(options: {
  config: AppConfig;
  configPath: string;
  plugin: DiscoveredPluginManifest;
  force?: boolean;
  dependencies?: PluginServiceInstallDependencies;
}): Promise<void> {
  const services = (options.plugin.manifest.services ?? []).filter((service) => service.autoStart !== false);
  if (services.length === 0) {
    return;
  }

  const dependencies = options.dependencies ?? {};
  const setup = createPluginSetupPaths({
    config: options.config,
    configPath: options.configPath,
    plugin: options.plugin,
    platform: dependencies.setupPlatform,
  });
  const plans = services.map((service) => ({
    service,
    plan: createPluginServicePlan({
      config: options.config,
      configPath: options.configPath,
      plugin: options.plugin,
      service,
      env: dependencies.env,
      setup,
    }),
  }));
  const servicesWithMissingEnv = plans.filter(({ plan }) => plan.missingRequiredEnv.length > 0);
  if (servicesWithMissingEnv.length > 0) {
    throw new Error(
      [
        `Plugin "${options.plugin.manifest.id}" service installation requires missing environment variables:`,
        ...servicesWithMissingEnv.map(
          ({ service, plan }) => `- ${service.id}: ${plan.missingRequiredEnv.join(", ")}`,
        ),
        "Export the variables before installing plugin services.",
      ].join("\n"),
    );
  }

  await preparePluginSetup({
    plugin: options.plugin,
    setup,
    dependencies,
  });

  for (const { service, plan } of plans) {
    const result = await installService({
      configPath: options.configPath,
      force: options.force,
      platform: dependencies.platform,
      homeDir: dependencies.homeDir,
      uid: dependencies.uid,
      installer: dependencies.installer,
      serviceName: plan.serviceName,
      serviceLabel: plan.serviceLabel,
      description: plan.description,
      workingDirectory: plan.workingDirectory,
      command: plan.command,
      args: plan.args,
      environmentPath: plan.environmentPath,
      serviceEnvironment: plan.environment,
    });

    dependencies.writeOutput?.(
      `Installed plugin service "${options.plugin.manifest.id}:${service.id}" at ${result.operation.definitionPath}`,
    );
  }
}

export async function installConfiguredPluginServices(options: {
  config: AppConfig;
  configPath: string;
  force?: boolean;
  dependencies?: PluginServiceInstallDependencies;
}): Promise<void> {
  for (const pluginConfig of options.config.plugins ?? []) {
    if (!pluginConfig.enabled || !pluginConfig.package?.path) {
      continue;
    }

    const pluginRoot = resolvePathRelativeToConfig(pluginConfig.package.path, dirname(options.configPath));
    const discovered = await readPluginManifest(pluginRoot, join(pluginRoot, PLUGIN_MANIFEST_FILE));
    if ("issue" in discovered) {
      throw new Error(`Could not install services for plugin "${pluginConfig.id}": ${discovered.issue.message}`);
    }

    await installPluginServices({
      config: options.config,
      configPath: options.configPath,
      plugin: discovered.plugin,
      force: options.force,
      dependencies: options.dependencies,
    });
  }
}

function createPluginServicePlan(options: {
  config: AppConfig;
  configPath: string;
  plugin: DiscoveredPluginManifest;
  service: PluginServiceManifest;
  env?: NodeJS.ProcessEnv;
  setup: PluginSetupPaths;
}) {
  const serviceName = createPluginServiceName(options.plugin.manifest.id, options.service.id);
  const serviceLabel = createPluginServiceLabel(options.plugin.manifest.id, options.service.id);
  const configDir = dirname(options.configPath);
  const environmentPath = join(configDir, "plugin-services", `${serviceName}.env`);
  const workingDirectory = resolve(options.plugin.rootDir, options.service.cwd ?? ".");
  const environmentResult = createPluginServiceEnvironment(options);

  return {
    serviceName,
    serviceLabel,
    description: `imp plugin service ${options.plugin.manifest.id}:${options.service.id}`,
    workingDirectory,
    command: resolvePluginServiceCommand(options.service.command),
    args: options.service.args ?? [],
    environmentPath,
    environment: environmentResult.environment,
    missingRequiredEnv: environmentResult.missingRequiredEnv,
  };
}

function createPluginServiceEnvironment(options: {
  config: AppConfig;
  configPath: string;
  plugin: DiscoveredPluginManifest;
  service: PluginServiceManifest;
  env?: NodeJS.ProcessEnv;
  setup: PluginSetupPaths;
}): { environment: NodeJS.ProcessEnv; missingRequiredEnv: string[] } {
  const env = { ...process.env, ...options.env };
  const environment: NodeJS.ProcessEnv = {
    IMP_CONFIG_PATH: options.configPath,
    IMP_PLUGIN_ID: options.plugin.manifest.id,
    IMP_PLUGIN_ROOT: options.plugin.rootDir,
  };
  const missingRequiredEnv: string[] = [];

  for (const [name, value] of Object.entries(options.service.env ?? {})) {
    if (value === "required") {
      const resolvedValue = env[name];
      if (typeof resolvedValue === "string" && resolvedValue.length > 0) {
        environment[name] = resolvedValue;
      } else {
        missingRequiredEnv.push(name);
      }
      continue;
    }

    environment[name] = renderPluginServiceEnvTemplate(value, options);
  }

  return { environment, missingRequiredEnv };
}

function renderPluginServiceEnvTemplate(
  value: string,
  options: {
    config: AppConfig;
    configPath: string;
    plugin: DiscoveredPluginManifest;
    setup: PluginSetupPaths;
  },
): string {
  const configDir = dirname(options.configPath);
  const dataRoot = resolvePathRelativeToConfig(options.config.paths.dataRoot, configDir);

  return value
    .replaceAll("{{config.path}}", options.configPath)
    .replaceAll("{{plugin.id}}", options.plugin.manifest.id)
    .replaceAll("{{plugin.rootDir}}", options.plugin.rootDir)
    .replaceAll("{{paths.dataRoot}}", dataRoot)
    .replaceAll("{{setup.python.venvDir}}", options.setup.python?.venvDir ?? "")
    .replaceAll("{{setup.python.venvPython}}", options.setup.python?.venvPython ?? "")
    .replace(/\{\{endpoint\.([A-Za-z0-9_-]+)\.runtimeDir\}\}/g, (_match, endpointId: string) =>
      resolvePluginEndpointRuntimeDir({
        dataRoot,
        pluginId: options.plugin.manifest.id,
        endpointId,
      }),
    );
}

function resolvePluginEndpointRuntimeDir(options: {
  dataRoot: string;
  pluginId: string;
  endpointId: string;
}): string {
  return join(options.dataRoot, "runtime", "plugins", options.pluginId, "endpoints", options.endpointId);
}

interface PluginSetupPaths {
  python?: {
    venvDir: string;
    venvPython: string;
    requirementsPath?: string;
    pythonCommand: string;
  };
}

function createPluginSetupPaths(options: {
  config: AppConfig;
  configPath: string;
  plugin: DiscoveredPluginManifest;
  platform?: ServicePlatformInput;
}): PluginSetupPaths {
  const pythonSetup = options.plugin.manifest.setup?.python;
  if (!pythonSetup) {
    return {};
  }

  const configDir = dirname(options.configPath);
  const dataRoot = resolvePathRelativeToConfig(options.config.paths.dataRoot, configDir);
  const venvDir = resolve(
    dataRoot,
    pythonSetup.venv ?? join("plugins", "state", options.plugin.manifest.id, "python", ".venv"),
  );
  const venvPython = resolveVenvPythonPath({
    venvDir,
    platform: options.platform,
  });

  return {
    python: {
      venvDir,
      venvPython,
      requirementsPath: pythonSetup.requirements ? resolve(options.plugin.rootDir, pythonSetup.requirements) : undefined,
      pythonCommand: pythonSetup.python ?? "python3",
    },
  };
}

function resolveVenvPythonPath(options: { venvDir: string; platform?: ServicePlatformInput }): string {
  const platform = resolveNodePlatform(options.platform);
  if (platform === "win32") {
    return join(options.venvDir, "Scripts", "python.exe");
  }

  return join(options.venvDir, "bin", "python");
}

function resolveNodePlatform(platform: ServicePlatformInput = process.platform): NodeJS.Platform {
  if (platform === "windows-winsw") {
    return "win32";
  }

  if (platform === "linux-systemd-user") {
    return "linux";
  }

  if (platform === "macos-launchd-agent") {
    return "darwin";
  }

  return platform;
}

async function preparePluginSetup(options: {
  plugin: DiscoveredPluginManifest;
  setup: PluginSetupPaths;
  dependencies: PluginServiceInstallDependencies;
}): Promise<void> {
  const pythonSetup = options.setup.python;
  if (!pythonSetup) {
    return;
  }

  const runner = options.dependencies.setupRunner ?? defaultPluginSetupRunner;
  const env = options.dependencies.env ? { ...process.env, ...options.dependencies.env } : undefined;

  await mkdir(dirname(pythonSetup.venvDir), { recursive: true });
  await runner.run(pythonSetup.pythonCommand, ["-m", "venv", pythonSetup.venvDir], { env });

  if (pythonSetup.requirementsPath) {
    await runner.run(pythonSetup.venvPython, ["-m", "pip", "install", "-r", pythonSetup.requirementsPath], {
      env,
    });
  }

  options.dependencies.writeOutput?.(
    `Prepared plugin Python environment "${options.plugin.manifest.id}" at ${pythonSetup.venvDir}`,
  );
}

const defaultPluginSetupRunner: PluginSetupRunner = {
  async run(command, args, options) {
    await execFileAsync(command, args, options);
  },
};

function createPluginServiceName(pluginId: string, serviceId: string): string {
  return `${sanitizeServiceNameSegment(pluginId)}-${sanitizeServiceNameSegment(serviceId)}`;
}

function createPluginServiceLabel(pluginId: string, serviceId: string): string {
  return `dev.${sanitizeServiceNameSegment(pluginId)}.${sanitizeServiceNameSegment(serviceId)}`;
}

function sanitizeServiceNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function resolvePluginServiceCommand(command: string): string {
  return command === "node" ? process.execPath : command;
}
