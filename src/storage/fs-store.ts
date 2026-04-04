import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationRef, ConversationState } from "../domain/conversation.js";
import type { RuntimePaths } from "../daemon/types.js";
import type { ConversationStore } from "./types.js";

function getConversationPath(conversationsDir: string, ref: ConversationRef): string {
  return join(
    conversationsDir,
    sanitizePathSegment(ref.transport),
    sanitizePathSegment(ref.externalId),
    "meta.json",
  );
}

export function createFsConversationStore(paths: RuntimePaths): ConversationStore {
  return {
    async get(ref) {
      const path = getConversationPath(paths.conversationsDir, ref);
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
      const path = getConversationPath(paths.conversationsDir, state.conversation);
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
