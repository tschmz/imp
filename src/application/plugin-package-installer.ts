import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config/types.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "../config/secret-value.js";
import { PLUGIN_MANIFEST_FILE } from "../plugins/manifest.js";
import { readPluginManifest, type DiscoveredPluginManifest } from "../plugins/discovery.js";

const execFileAsync = promisify(execFile);

export type PluginPackageInstaller = (options: {
  packageSpec: string;
  packageName?: string;
  storeRoot: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<{ packageRoot: string }>;

export interface PluginPackageInstallationDependencies {
  env?: NodeJS.ProcessEnv;
  installPackage?: PluginPackageInstaller;
}

export function createPluginPackageInstaller(dependencies: PluginPackageInstallationDependencies = {}) {
  const installPackage = dependencies.installPackage ?? installNpmPackage;

  return {
    async installFromPackageSpec(options: {
      packageSpec: string;
      config: AppConfig;
      configPath: string;
      writeOutput: (text: string) => void;
    }): Promise<DiscoveredPluginManifest> {
      const normalizedPackageSpec = normalizePackageSpec(options.packageSpec);
      const packageName = tryParseNpmPackageName(options.packageSpec);
      const storeRoot = getPluginPackageStoreRoot(options.config, options.configPath);

      const { packageRoot } = await installPackage({
        packageSpec: normalizedPackageSpec,
        packageName,
        storeRoot,
        env: dependencies.env,
      });
      options.writeOutput(`Installed plugin package "${options.packageSpec}" into ${storeRoot}`);

      const discovered = await readPluginManifest(packageRoot, join(packageRoot, PLUGIN_MANIFEST_FILE));
      if ("issue" in discovered) {
        throw new Error(
          `Installed package "${options.packageSpec}" does not contain a valid plugin manifest: ${discovered.issue.message}`,
        );
      }

      return discovered.plugin;
    },
  };
}

export function getPluginPackageStoreRoot(config: AppConfig, configPath: string): string {
  const configDir = dirname(configPath);
  const dataRoot = resolvePathRelativeToConfig(config.paths.dataRoot, configDir);
  return join(dataRoot, "plugins", "npm");
}

export function normalizePackageSpec(packageSpec: string): string {
  return packageSpec.startsWith("npm:") ? packageSpec.slice("npm:".length) : packageSpec;
}

export function parseNpmPackageName(packageSpec: string): string {
  const normalized = normalizePackageSpec(packageSpec);
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
