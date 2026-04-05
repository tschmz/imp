import { delimiter } from "node:path";

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

export function renderLinuxServiceEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const pathValue = buildLinuxServicePath(env);
  return `PATH=${quoteEnvironmentValue(pathValue)}\n`;
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
