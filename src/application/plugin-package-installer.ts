import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import npa from "npm-package-arg";
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

  const parsed = npa(normalized);
  if (parsed.type === "directory" || parsed.type === "file") {
    throw new Error(`Package path specs do not encode a package name: ${packageSpec}`);
  }

  if (!parsed.name) {
    throw new Error(`Package spec does not encode an npm package name: ${packageSpec}`);
  }

  return parsed.name;
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
  const declaredBefore = await readDeclaredTopLevelDependencies(options.storeRoot);
  await execFileAsync("npm", ["install", options.packageSpec, "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: options.storeRoot,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });
  const declaredAfter = await readDeclaredTopLevelDependencies(options.storeRoot);

  return {
    packageRoot: await resolveInstalledPackageRoot({
      ...options,
      candidatePackageNames: selectCandidatePackageNames({
        packageSpec: options.packageSpec,
        packageName: options.packageName,
        declaredBefore,
        declaredAfter,
      }),
    }),
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

async function readDeclaredTopLevelDependencies(storeRoot: string): Promise<Record<string, string>> {
  const packageJson = JSON.parse(await readFile(join(storeRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, unknown>;
  };
  const dependencies = packageJson.dependencies ?? {};
  return Object.fromEntries(
    Object.entries(dependencies)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function selectCandidatePackageNames(options: {
  packageSpec: string;
  packageName?: string;
  declaredBefore: Record<string, string>;
  declaredAfter: Record<string, string>;
}): string[] {
  if (options.packageName) {
    return [options.packageName];
  }

  const declaredAfterNames = Object.keys(options.declaredAfter);
  const newlyInstalledPackageNames = declaredAfterNames.filter((name) => !(name in options.declaredBefore));
  if (newlyInstalledPackageNames.length > 0) {
    return newlyInstalledPackageNames;
  }

  const packageSpecMatches = declaredAfterNames.filter((name) => options.declaredAfter[name] === options.packageSpec);
  if (packageSpecMatches.length > 0) {
    return packageSpecMatches;
  }

  const changedDependencyNames = declaredAfterNames.filter(
    (name) => options.declaredBefore[name] !== options.declaredAfter[name],
  );
  if (changedDependencyNames.length > 0) {
    return changedDependencyNames;
  }

  return declaredAfterNames;
}

export async function resolveInstalledPackageRoot(options: {
  packageSpec: string;
  packageName?: string;
  storeRoot: string;
  candidatePackageNames: string[];
}): Promise<string> {
  if (options.packageName) {
    const packageRoot = join(options.storeRoot, "node_modules", ...options.packageName.split("/"));
    await access(join(packageRoot, PLUGIN_MANIFEST_FILE));
    return packageRoot;
  }

  const pluginCandidates: string[] = [];
  for (const candidateName of options.candidatePackageNames) {
    const packageRoot = join(options.storeRoot, "node_modules", ...candidateName.split("/"));
    const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
      name?: string;
    };
    if (packageManifest.name !== candidateName) {
      continue;
    }
    try {
      await access(join(packageRoot, PLUGIN_MANIFEST_FILE));
      pluginCandidates.push(packageRoot);
    } catch {
      // ignore non-plugin package candidates
    }
  }

  if (pluginCandidates.length === 1) {
    return pluginCandidates[0];
  }
  if (pluginCandidates.length === 0) {
    throw new Error(
      `Could not resolve installed package root for "${options.packageSpec}": no plugin package found among candidates ${options.candidatePackageNames.join(", ")}.`,
    );
  }
  throw new Error(
    `Could not resolve installed package root for "${options.packageSpec}": multiple plugin packages matched (${pluginCandidates.join(", ")}).`,
  );
}
