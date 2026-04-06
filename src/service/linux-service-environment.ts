import { delimiter } from "node:path";
import { readFile } from "node:fs/promises";

const preferredUserPathEntries = [
  "${HOME}/.local/bin",
  "${HOME}/bin",
  "${HOME}/.npm-global/bin",
  "${HOME}/.volta/bin",
  "${HOME}/.cargo/bin",
  "${HOME}/go/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/local/sbin",
  "/usr/sbin",
  "/sbin",
];

export async function renderLinuxServiceEnvironment(options: {
  path?: string;
  env?: NodeJS.ProcessEnv;
  pathEnv?: NodeJS.ProcessEnv;
  force?: boolean;
} = {}): Promise<string> {
  const env = options.env ?? {};
  const pathEnv = options.pathEnv ?? process.env;
  const existingEntries =
    options.path && options.force
      ? await loadEnvironmentFile(options.path)
      : new Map<string, string>();
  const mergedEntries = new Map(existingEntries);

  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }

    mergedEntries.set(name, value);
  }

  mergedEntries.set("PATH", buildLinuxServicePath({
    ...Object.fromEntries(existingEntries),
    ...pathEnv,
    ...("PATH" in env ? { PATH: env.PATH } : {}),
  }));

  return [...mergedEntries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${quoteEnvironmentValue(value)}`)
    .join("\n")
    .concat("\n");
}

export function buildLinuxServicePath(env: NodeJS.ProcessEnv = process.env): string {
  const entries = [
    ...splitPathEntries(env.PATH),
    ...preferredUserPathEntries,
  ];

  return dedupePathEntries(entries).join(":");
}

function splitPathEntries(pathValue: string | undefined): string[] {
  if (!pathValue) {
    return [];
  }

  return pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of entries) {
    if (seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    result.push(entry);
  }

  return result;
}

function quoteEnvironmentValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

async function loadEnvironmentFile(path: string): Promise<Map<string, string>> {
  try {
    const content = await readFile(path, "utf8");
    return parseEnvironmentFile(content);
  } catch (error) {
    if (isMissingFileError(error)) {
      return new Map<string, string>();
    }

    throw error;
  }
}

function parseEnvironmentFile(content: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    entries.set(name, unquoteEnvironmentValue(rawValue));
  }

  return entries;
}

function unquoteEnvironmentValue(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replaceAll("\\\"", "\"").replaceAll("\\\\", "\\");
  }

  return value;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
