import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseConfigJson } from "../config/config-json.js";
import { PLUGIN_MANIFEST_FILE, USER_PLUGIN_MANIFEST_FILE, pluginManifestSchema, type PluginManifest } from "./manifest.js";

export interface DiscoveredPluginManifest {
  rootDir: string;
  manifestPath: string;
  manifestHash: string;
  manifest: PluginManifest;
}

export interface PluginDiscoveryIssue {
  path: string;
  message: string;
}

export interface PluginDiscoveryResult {
  plugins: DiscoveredPluginManifest[];
  issues: PluginDiscoveryIssue[];
}

export async function discoverPluginManifests(rootDirs: string[]): Promise<PluginDiscoveryResult> {
  const plugins: DiscoveredPluginManifest[] = [];
  const issues: PluginDiscoveryIssue[] = [];

  for (const rootDir of uniqueResolvedPaths(rootDirs)) {
    const entries = await readPluginRootEntries(rootDir, issues);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginRoot = join(rootDir, entry.name);
      const discovered = await readPluginManifestFromDirectory(pluginRoot);
      if ("issue" in discovered) {
        issues.push(discovered.issue);
        continue;
      }

      plugins.push(discovered.plugin);
    }
  }

  plugins.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

  return {
    plugins,
    issues,
  };
}

export async function readPluginManifestFromDirectory(rootDir: string): Promise<
  | {
      plugin: DiscoveredPluginManifest;
    }
  | {
      issue: PluginDiscoveryIssue;
    }
> {
  const primaryManifestPath = join(rootDir, USER_PLUGIN_MANIFEST_FILE);
  const primary = await readPluginManifest(rootDir, primaryManifestPath);
  if ("plugin" in primary || !isMissingFileError(primary.issue.message)) {
    return primary;
  }

  return readPluginManifest(rootDir, join(rootDir, PLUGIN_MANIFEST_FILE));
}

export async function readPluginManifest(rootDir: string, manifestPath: string): Promise<
  | {
      plugin: DiscoveredPluginManifest;
    }
  | {
      issue: PluginDiscoveryIssue;
    }
> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = parseConfigJson(raw, { errorPrefix: `Invalid plugin manifest ${manifestPath}` });
    const result = pluginManifestSchema.safeParse(parsed);
    if (!result.success) {
      return {
        issue: {
          path: manifestPath,
          message: result.error.issues
            .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
            .join("\n"),
        },
      };
    }

    return {
      plugin: {
        rootDir,
        manifestPath,
        manifestHash: createManifestHash(raw),
        manifest: result.data,
      },
    };
  } catch (error) {
    return {
      issue: {
        path: manifestPath,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function createManifestHash(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

async function readPluginRootEntries(rootDir: string, issues: PluginDiscoveryIssue[]) {
  try {
    return await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    issues.push({
      path: rootDir,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function uniqueResolvedPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => resolve(path))));
}

function isMissingFileError(message: string): boolean {
  return message.includes("ENOENT") || message.includes("no such file or directory");
}
