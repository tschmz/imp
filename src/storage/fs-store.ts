import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ConversationMessage,
  ConversationContext,
  ConversationRef,
} from "../domain/conversation.js";
import type { RuntimePaths } from "../daemon/types.js";
import type { ConversationStore } from "./types.js";

function getConversationDir(conversationsDir: string, ref: ConversationRef): string {
  return join(
    conversationsDir,
    sanitizePathSegment(ref.transport),
    sanitizePathSegment(ref.externalId),
  );
}

function getConversationSnapshotPath(conversationsDir: string, ref: ConversationRef): string {
  return join(getConversationDir(conversationsDir, ref), "conversation.json");
}

export function createFsConversationStore(paths: RuntimePaths): ConversationStore {
  return {
    async get(ref) {
      const snapshotPath = getConversationSnapshotPath(paths.conversationsDir, ref);
      try {
        const raw = await readFile(snapshotPath, "utf8");
        return normalizeSnapshot(JSON.parse(raw) as ConversationContext);
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return readLegacyConversation(paths.conversationsDir, ref);
        }
        throw error;
      }
    },
    async put(context) {
      const snapshotPath = getConversationSnapshotPath(paths.conversationsDir, context.state.conversation);
      const current = await this.get(context.state.conversation);
      const normalizedContext = normalizeSnapshot(context);
      assertNoWriteConflict(normalizedContext, current);

      const nextSnapshot: ConversationContext = {
        ...normalizedContext,
        state: {
          ...normalizedContext.state,
          version: (current?.state.version ?? 0) + 1,
        },
      };

      const tempPath = `${snapshotPath}.tmp`;
      await mkdir(dirname(snapshotPath), { recursive: true });
      await writeFile(tempPath, JSON.stringify(nextSnapshot, null, 2));
      await rename(tempPath, snapshotPath);
    },
  };
}

async function readLegacyConversation(
  conversationsDir: string,
  ref: ConversationRef,
): Promise<ConversationContext | undefined> {
  const statePath = join(getConversationDir(conversationsDir, ref), "meta.json");

  try {
    const raw = await readFile(statePath, "utf8");
    const state = JSON.parse(raw) as ConversationContext["state"];
    const messages = await readLegacyMessages(conversationsDir, ref);
    return normalizeSnapshot({
      state,
      messages,
    });
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readLegacyMessages(
  conversationsDir: string,
  ref: ConversationRef,
): Promise<ConversationMessage[]> {
  const path = join(getConversationDir(conversationsDir, ref), "messages.json");

  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as ConversationMessage[];
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return [];
    }

    throw error;
  }
}

function normalizeSnapshot(snapshot: ConversationContext): ConversationContext {
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      version: snapshot.state.version ?? 0,
    },
  };
}

function assertNoWriteConflict(
  incoming: ConversationContext,
  current: ConversationContext | undefined,
): void {
  if (!current) {
    return;
  }

  if (incoming.state.version !== current.state.version) {
    throw new Error("Conversation write conflict: version mismatch");
  }

  if (incoming.state.updatedAt <= current.state.updatedAt) {
    throw new Error("Conversation write conflict: updatedAt must increase");
  }
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
