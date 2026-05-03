import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { createKeyedSerialTaskQueue } from "../../concurrency/async-primitives.js";
import { isMissingFileError } from "../../files/node-error.js";

const promptHistoryVersion = 1;
const maxPromptHistoryEntries = 100;
const promptHistoryWriteQueue = createKeyedSerialTaskQueue<string>();

export interface CliPromptHistoryStore {
  read(agentId: string): Promise<string[]>;
  add(agentId: string, text: string): Promise<string[]>;
}

interface StoredCliPromptHistory {
  version?: number;
  agentId?: string;
  entries?: unknown;
}

export function createCliPromptHistoryStore(dataRoot: string): CliPromptHistoryStore {
  return {
    async read(agentId) {
      const path = getCliPromptHistoryPath(dataRoot, agentId);
      return await promptHistoryWriteQueue.run(path, () => readCliPromptHistory(path));
    },
    async add(agentId, text) {
      const path = getCliPromptHistoryPath(dataRoot, agentId);
      return await promptHistoryWriteQueue.run(path, async () => {
        const current = await readCliPromptHistory(path);
        const next = addCliPromptHistoryEntry(current, text);

        if (next.length === current.length && next.every((entry, index) => entry === current[index])) {
          return current;
        }

        await writeCliPromptHistory(path, {
          version: promptHistoryVersion,
          agentId,
          entries: next,
        });
        return next;
      });
    },
  };
}

export function getCliPromptHistoryPath(dataRoot: string, agentId: string): string {
  return join(dataRoot, "sessions", sanitizePathSegment(agentId), "prompt-history.json");
}

export function addCliPromptHistoryEntry(entries: readonly string[], text: string): string[] {
  const trimmed = text.trim();
  const current = normalizeCliPromptHistoryEntries(entries);

  if (!trimmed) {
    return current;
  }

  if (current[0] === trimmed) {
    return current;
  }

  return [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, maxPromptHistoryEntries);
}

async function readCliPromptHistory(path: string): Promise<string[]> {
  let raw;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  let parsed: StoredCliPromptHistory;

  try {
    parsed = JSON.parse(raw) as StoredCliPromptHistory;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.entries)) {
    return [];
  }

  return normalizeCliPromptHistoryEntries(parsed.entries);
}

function normalizeCliPromptHistoryEntries(entries: readonly unknown[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);

    if (normalized.length >= maxPromptHistoryEntries) {
      break;
    }
  }

  return normalized;
}

async function writeCliPromptHistory(
  path: string,
  history: { version: number; agentId: string; entries: string[] },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(history, null, 2)}\n`);
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replaceAll(/[\\/]/g, "_");
  return sanitized.length === 0 || sanitized === "." || sanitized === ".." ? "_" : sanitized;
}
