import { readFile } from "node:fs/promises";
import { isMissingFileError } from "../files/node-error.js";

export async function renderLinuxServiceEnvironment(options: {
  path?: string;
  env?: NodeJS.ProcessEnv;
  force?: boolean;
} = {}): Promise<string> {
  const env = options.env ?? {};
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

  return [...mergedEntries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${quoteEnvironmentValue(value)}`)
    .join("\n")
    .concat("\n");
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
