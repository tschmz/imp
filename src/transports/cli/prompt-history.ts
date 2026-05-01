import { Buffer } from "node:buffer";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { isMissingFileError } from "../../files/node-error.js";

const promptHistoryVersion = 1;
const maxPromptHistoryEntries = 100;

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
      return readCliPromptHistory(getCliPromptHistoryPath(dataRoot, agentId));
    },
    async add(agentId, text) {
      const path = getCliPromptHistoryPath(dataRoot, agentId);
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
    },
  };
}

export function getCliPromptHistoryPath(dataRoot: string, agentId: string): string {
  return join(dataRoot, "history", "cli", `${encodeHistoryFileSegment(agentId)}.json`);
}

export function addCliPromptHistoryEntry(entries: readonly string[], text: string): string[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return entries.slice();
  }

  if (entries[0] === trimmed) {
    return entries.slice();
  }

  return [trimmed, ...entries].slice(0, maxPromptHistoryEntries);
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

  return parsed.entries
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, maxPromptHistoryEntries);
}

async function writeCliPromptHistory(
  path: string,
  history: { version: number; agentId: string; entries: string[] },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(history, null, 2)}\n`);
}

function encodeHistoryFileSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
