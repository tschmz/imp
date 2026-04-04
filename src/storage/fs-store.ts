import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationRef, ConversationState } from "../domain/conversation.js";
import type { ConversationStore } from "./types.js";

function getConversationPath(dataDir: string, ref: ConversationRef): string {
  return join(
    dataDir,
    "conversations",
    sanitizePathSegment(ref.transport),
    sanitizePathSegment(ref.externalId),
    "meta.json",
  );
}

export function createFsConversationStore(dataDir: string): ConversationStore {
  return {
    async get(ref) {
      const path = getConversationPath(dataDir, ref);
      try {
        const raw = await readFile(path, "utf8");
        return JSON.parse(raw) as ConversationState;
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async put(state) {
      const path = getConversationPath(dataDir, state.conversation);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(state, null, 2));
    },
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function sanitizePathSegment(value: string): string {
  return value.replaceAll("/", "_");
}
