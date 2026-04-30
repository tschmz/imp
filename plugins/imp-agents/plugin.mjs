import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createApplyPatchTool } from "./lib/apply-patch.mjs";

const DEFAULT_MAX_ENTRIES = 80;
const MAX_MAX_ENTRIES = 200;
const AGENTS_SNIPPET_CHARS = 1200;
const SKIPPED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

export function registerPlugin() {
  return {
    tools: [
      createApplyPatchTool(),
      {
        name: "workspaceSnapshot",
        label: "workspaceSnapshot",
        description: "Create a shallow, read-only snapshot of a software workspace for coding-agent orientation.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              minLength: 1,
              description: "Workspace directory to inspect. Relative paths resolve from the current process working directory.",
            },
            maxEntries: {
              type: "integer",
              minimum: 1,
              maximum: MAX_MAX_ENTRIES,
              description: "Maximum number of top-level entries to include. Defaults to 80.",
            },
          },
          additionalProperties: false,
        },
        async execute(_toolCallId, params, signal) {
          const options = parseWorkspaceSnapshotParams(params);
          const snapshot = await createWorkspaceSnapshot(options, signal);
          return {
            content: [{ type: "text", text: renderWorkspaceSnapshot(snapshot) }],
            details: snapshot,
          };
        },
      },
    ],
  };
}

function parseWorkspaceSnapshotParams(params) {
  if (params === undefined || params === null) {
    return {
      path: process.cwd(),
      maxEntries: DEFAULT_MAX_ENTRIES,
    };
  }

  if (!isRecord(params)) {
    throw new Error("workspaceSnapshot requires an object parameter.");
  }

  const path = params.path === undefined ? process.cwd() : parsePath(params.path);
  const maxEntries = params.maxEntries === undefined
    ? DEFAULT_MAX_ENTRIES
    : parseMaxEntries(params.maxEntries);

  return { path, maxEntries };
}

function parsePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("workspaceSnapshot path must be a non-empty string.");
  }

  return value;
}

function parseMaxEntries(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_MAX_ENTRIES) {
    throw new Error(`workspaceSnapshot maxEntries must be an integer between 1 and ${MAX_MAX_ENTRIES}.`);
  }

  return value;
}

async function createWorkspaceSnapshot(options, signal) {
  const targetPath = await resolveWorkspaceDirectory(options.path);
  const git = await readGitState(targetPath, signal);
  const projectRoot = git.root ?? targetPath;
  const [packageJson, topLevelEntries, agentsFiles, pluginManifests] = await Promise.all([
    readPackageSummary(projectRoot),
    listTopLevelEntries(projectRoot, options.maxEntries),
    readAgentInstructionFiles(projectRoot),
    findFiles(projectRoot, new Set(["plugin.json", "imp-plugin.json"]), { maxDepth: 4, maxFiles: 30 }),
  ]);

  return {
    requestedPath: options.path,
    targetPath,
    projectRoot,
    git,
    packageJson,
    topLevelEntries,
    agentsFiles,
    pluginManifests: pluginManifests.map((path) => relativePath(projectRoot, path)),
  };
}

async function resolveWorkspaceDirectory(path) {
  const resolved = resolve(path);
  const info = await stat(resolved).catch((error) => {
    throw new Error(`workspaceSnapshot could not access ${resolved}: ${formatError(error)}`);
  });

  if (info.isDirectory()) {
    return resolved;
  }

  if (info.isFile()) {
    return dirname(resolved);
  }

  throw new Error(`workspaceSnapshot path must point to a file or directory: ${resolved}`);
}

async function readGitState(cwd, signal) {
  const rootResult = await runGit(["rev-parse", "--show-toplevel"], cwd, signal);
  if (!rootResult.ok) {
    return {
      available: false,
      reason: rootResult.stderr || rootResult.error || "not a git repository",
    };
  }

  const root = rootResult.stdout.trim();
  const [branchResult, statusResult] = await Promise.all([
    runGit(["branch", "--show-current"], root, signal),
    runGit(["status", "--short"], root, signal),
  ]);
  const status = statusResult.ok
    ? statusResult.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
    : [];

  return {
    available: true,
    root,
    branch: branchResult.ok ? branchResult.stdout.trim() || "(detached)" : undefined,
    clean: status.length === 0,
    status: status.slice(0, 50),
    statusTruncated: status.length > 50,
  };
}

function runGit(args, cwd, signal) {
  return new Promise((resolvePromise) => {
    execFile("git", args, { cwd, signal, timeout: 1500 }, (error, stdout, stderr) => {
      resolvePromise({
        ok: !error,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? "").trim(),
        error: error ? formatError(error) : undefined,
      });
    });
  });
}

async function readPackageSummary(projectRoot) {
  const packagePath = join(projectRoot, "package.json");
  const raw = await readFile(packagePath, "utf8").catch((error) => {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  });
  if (raw === undefined) {
    return undefined;
  }

  const parsed = JSON.parse(raw);
  const scripts = isRecord(parsed.scripts) ? Object.keys(parsed.scripts).sort() : [];

  return {
    path: "package.json",
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    version: typeof parsed.version === "string" ? parsed.version : undefined,
    type: typeof parsed.type === "string" ? parsed.type : undefined,
    packageManager: typeof parsed.packageManager === "string" ? parsed.packageManager : undefined,
    scripts,
    dependencyCount: countRecordKeys(parsed.dependencies),
    devDependencyCount: countRecordKeys(parsed.devDependencies),
  };
}

async function listTopLevelEntries(projectRoot, maxEntries) {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".") || entry.name === ".github")
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, maxEntries)
    .map((entry) => ({
      name: entry.isDirectory() ? `${entry.name}/` : entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }));
}

async function readAgentInstructionFiles(projectRoot) {
  const paths = await findFiles(projectRoot, new Set(["AGENTS.md"]), { maxDepth: 4, maxFiles: 12 });
  return Promise.all(paths.map(async (path) => {
    const text = await readFile(path, "utf8");
    return {
      path: relativePath(projectRoot, path),
      excerpt: trimExcerpt(text, AGENTS_SNIPPET_CHARS),
    };
  }));
}

async function findFiles(root, fileNames, options) {
  const found = [];
  await scan(root, 0);
  return found;

  async function scan(directory, depth) {
    if (found.length >= options.maxFiles || depth > options.maxDepth) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (found.length >= options.maxFiles) {
        return;
      }

      const path = join(directory, entry.name);
      if (entry.isFile() && fileNames.has(entry.name)) {
        found.push(path);
        continue;
      }

      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        await scan(path, depth + 1);
      }
    }
  }
}

function renderWorkspaceSnapshot(snapshot) {
  const lines = [
    "Workspace Snapshot",
    `Path: ${snapshot.targetPath}`,
    `Project root: ${snapshot.projectRoot}`,
    renderGitSummary(snapshot.git),
    renderPackageSummary(snapshot.packageJson),
    "",
    "Top-level entries:",
    ...renderList(snapshot.topLevelEntries.map((entry) => entry.name)),
    "",
    "Agent instructions:",
    ...renderAgentInstructions(snapshot.agentsFiles),
    "",
    "Plugin manifests:",
    ...renderList(snapshot.pluginManifests),
  ];

  if (snapshot.git.available && !snapshot.git.clean) {
    lines.push("", "Git status:", ...renderList(snapshot.git.status));
    if (snapshot.git.statusTruncated) {
      lines.push("- ...");
    }
  }

  return lines.join("\n");
}

function renderGitSummary(git) {
  if (!git.available) {
    return `Git: unavailable (${git.reason})`;
  }

  const state = git.clean ? "clean" : `${git.status.length}${git.statusTruncated ? "+" : ""} changed`;
  return `Git: ${git.branch ?? "(unknown branch)"} (${state})`;
}

function renderPackageSummary(packageJson) {
  if (!packageJson) {
    return "Package: none";
  }

  const name = packageJson.name ?? "(unnamed)";
  const version = packageJson.version ? `@${packageJson.version}` : "";
  const scripts = packageJson.scripts.length > 0 ? packageJson.scripts.join(", ") : "none";
  const metadata = [
    packageJson.type ? `type=${packageJson.type}` : undefined,
    packageJson.packageManager ? `packageManager=${packageJson.packageManager}` : undefined,
    `deps=${packageJson.dependencyCount}`,
    `devDeps=${packageJson.devDependencyCount}`,
  ].filter(Boolean).join("; ");

  return `Package: ${name}${version} (${metadata}; scripts=${scripts})`;
}

function renderAgentInstructions(files) {
  if (files.length === 0) {
    return ["- none"];
  }

  return files.map((file) => `- ${file.path}: ${firstContentLine(file.excerpt)}`);
}

function renderList(values) {
  if (values.length === 0) {
    return ["- none"];
  }

  return values.map((value) => `- ${value}`);
}

function trimExcerpt(text, maxLength) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}\n...`;
}

function firstContentLine(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "(empty)";
}

function relativePath(from, to) {
  return relative(from, to) || basename(to);
}

function countRecordKeys(value) {
  return isRecord(value) ? Object.keys(value).length : 0;
}

function isMissingFileError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
