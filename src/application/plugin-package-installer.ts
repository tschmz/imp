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
  const normalized = packageSpec.startsWith("npm:") ? packageSpec.slice("npm:".length) : packageSpec;
  return addDefaultRegistryTag(normalized);
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
  await repairMissingLocalDependencySpecs(options.storeRoot);
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

export async function repairMissingLocalDependencySpecs(storeRoot: string): Promise<void> {
  const packageJsonPath = join(storeRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: unknown;
    [key: string]: unknown;
  };
  if (!isStringRecord(packageJson.dependencies)) {
    return;
  }

  let changed = false;
  const dependencies = packageJson.dependencies;
  for (const [dependencyName, dependencySpec] of Object.entries(dependencies)) {
    let parsed: ReturnType<typeof npa.resolve>;
    try {
      parsed = npa.resolve(dependencyName, dependencySpec, storeRoot);
    } catch {
      continue;
    }

    if ((parsed.type !== "file" && parsed.type !== "directory") || !parsed.fetchSpec) {
      continue;
    }
    if (await pathExists(parsed.fetchSpec)) {
      continue;
    }

    const installedVersion = await readInstalledPackageVersion(storeRoot, dependencyName);
    if (installedVersion) {
      dependencies[dependencyName] = installedVersion;
    } else {
      delete dependencies[dependencyName];
    }
    changed = true;
  }

  if (changed) {
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  }
}

function addDefaultRegistryTag(packageSpec: string): string {
  let parsed: ReturnType<typeof npa> & { subSpec?: ReturnType<typeof npa> };
  try {
    parsed = npa(packageSpec);
  } catch {
    return packageSpec;
  }

  if (parsed.type === "range" && parsed.name && parsed.rawSpec === "*") {
    return `${parsed.name}@latest`;
  }
  if (
    parsed.type === "alias"
    && parsed.name
    && parsed.subSpec?.type === "range"
    && parsed.subSpec.name
    && parsed.subSpec.rawSpec === "*"
  ) {
    return `${parsed.name}@npm:${parsed.subSpec.name}@latest`;
  }
  return packageSpec;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string")
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readInstalledPackageVersion(storeRoot: string, packageName: string): Promise<string | undefined> {
  try {
    const packageManifest = JSON.parse(
      await readFile(join(storeRoot, "node_modules", ...packageName.split("/"), "package.json"), "utf8"),
    ) as {
      name?: unknown;
      version?: unknown;
    };
    return packageManifest.name === packageName
      && typeof packageManifest.version === "string"
      && packageManifest.version.length > 0
      ? packageManifest.version
      : undefined;
  } catch {
    return undefined;
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
