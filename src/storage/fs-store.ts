import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ConversationMessage,
  ConversationRef,
  ConversationState,
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

function getConversationStatePath(conversationsDir: string, ref: ConversationRef): string {
  return join(getConversationDir(conversationsDir, ref), "meta.json");
}

function getConversationMessagesPath(conversationsDir: string, ref: ConversationRef): string {
  return join(getConversationDir(conversationsDir, ref), "messages.json");
}

export function createFsConversationStore(paths: RuntimePaths): ConversationStore {
  return {
    async get(ref) {
      const statePath = getConversationStatePath(paths.conversationsDir, ref);
      try {
        const raw = await readFile(statePath, "utf8");
        const state = JSON.parse(raw) as ConversationState;
        const messages = await readConversationMessages(paths.conversationsDir, ref);

        return {
          state,
          messages,
        };
      } catch (error: unknown) {
        if (isMissingFile(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async put(context) {
      const statePath = getConversationStatePath(paths.conversationsDir, context.state.conversation);
      const messagesPath = getConversationMessagesPath(
        paths.conversationsDir,
        context.state.conversation,
      );
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(context.state, null, 2));
      await writeFile(messagesPath, JSON.stringify(context.messages, null, 2));
    },
  };
}

async function readConversationMessages(
  conversationsDir: string,
  ref: ConversationRef,
): Promise<ConversationMessage[]> {
  const path = getConversationMessagesPath(conversationsDir, ref);

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
