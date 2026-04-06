import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTimestampedBackupPath } from "../files/backup.js";
import type {
  ConversationMessage,
  ConversationContext,
  ConversationRef,
} from "../domain/conversation.js";
import type { RuntimePaths } from "../daemon/types.js";
import type { ConversationBackupSummary, ConversationStore } from "./types.js";

const conversationWriteQueues = new Map<string, Promise<void>>();
// The critical section is intentionally short: read latest snapshot, compute next state, atomically rename.
// A short-lived lock file guards that section across processes while the in-memory queue serializes writers locally.
const lockTtlMs = 30_000;
const lockRetryDelayMs = 25;
const lockRetryCount = 400;

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

function getConversationLockPath(conversationsDir: string, ref: ConversationRef): string {
  return join(getConversationDir(conversationsDir, ref), "conversation.lock");
}

export function createFsConversationStore(paths: RuntimePaths): ConversationStore {
  return {
    async get(ref) {
      return readConversationSnapshot(paths.conversationsDir, ref);
    },
    async put(context) {
      await withConversationWriteQueue(context.state.conversation, async () => {
        await withConversationLock(paths.conversationsDir, context.state.conversation, async () => {
          const snapshotPath = getConversationSnapshotPath(
            paths.conversationsDir,
            context.state.conversation,
          );
          const current = await readConversationSnapshot(
            paths.conversationsDir,
            context.state.conversation,
          );
          const nextSnapshot = resolveNextSnapshot(normalizeSnapshot(context), current);
          const tempPath = `${snapshotPath}.${process.pid}.tmp`;

          await mkdir(dirname(snapshotPath), { recursive: true });
          await writeFile(tempPath, JSON.stringify(nextSnapshot, null, 2));
          await rename(tempPath, snapshotPath);
        });
      });
    },
    async listBackups(ref) {
      return readConversationBackups(paths.conversationsDir, ref);
    },
    async restore(ref, backupId, options) {
      return withConversationWriteQueue(ref, async () =>
        withConversationLock(paths.conversationsDir, ref, async () => {
          const current = await readConversationSnapshot(paths.conversationsDir, ref);
          const backup = await readConversationBackup(paths.conversationsDir, ref, backupId);
          if (!backup) {
            return false;
          }

          const snapshotPath = getConversationSnapshotPath(paths.conversationsDir, ref);
          const tempPath = `${snapshotPath}.${process.pid}.tmp`;
          if (current) {
            const currentBackupPath = createTimestampedBackupPath(
              snapshotPath,
              options?.now ?? new Date(),
            );
            await writeConversationBackup(currentBackupPath, current);
          }
          const normalized = normalizeSnapshot({
            ...backup,
            state: {
              ...backup.state,
              conversation: ref,
            },
          });

          await mkdir(dirname(snapshotPath), { recursive: true });
          await writeFile(tempPath, JSON.stringify(normalized, null, 2));
          await rename(tempPath, snapshotPath);
          return true;
        }),
      );
    },
    async reset(ref, options) {
      const existing = await readConversationSnapshot(paths.conversationsDir, ref);
      if (!existing) {
        return;
      }

      await withConversationWriteQueue(ref, async () => {
        await withConversationLock(paths.conversationsDir, ref, async () => {
          const snapshot = await readConversationSnapshot(paths.conversationsDir, ref);
          if (!snapshot) {
            return;
          }

          const conversationDir = getConversationDir(paths.conversationsDir, ref);
          const snapshotPath = getConversationSnapshotPath(paths.conversationsDir, ref);
          const backupPath = createTimestampedBackupPath(
            snapshotPath,
            options?.now ?? new Date(),
          );

          await writeConversationBackup(backupPath, snapshot);
          await removeActiveConversationFiles(conversationDir);
        });
      });
    },
  };
}

async function readConversationBackups(
  conversationsDir: string,
  ref: ConversationRef,
): Promise<ConversationBackupSummary[]> {
  const conversationDir = getConversationDir(conversationsDir, ref);
  let entries;

  try {
    entries = await readdir(conversationDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const backupIds = entries
    .filter((entry) => entry.isFile() && isConversationBackupFile(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  const backups = await Promise.all(
    backupIds.map(async (backupId) => {
      const snapshot = await readConversationBackup(conversationsDir, ref, backupId);
      if (!snapshot) {
        return undefined;
      }

      return {
        id: backupId,
        createdAt: snapshot.state.createdAt,
        updatedAt: snapshot.state.updatedAt,
        agentId: snapshot.state.agentId,
        messageCount: snapshot.messages.length,
        ...(snapshot.state.workingDirectory
          ? { workingDirectory: snapshot.state.workingDirectory }
          : {}),
      } satisfies ConversationBackupSummary;
    }),
  );

  return backups.filter((backup): backup is ConversationBackupSummary => backup !== undefined);
}

async function readConversationSnapshot(
  conversationsDir: string,
  ref: ConversationRef,
): Promise<ConversationContext | undefined> {
  const snapshotPath = getConversationSnapshotPath(conversationsDir, ref);
  try {
    const raw = await readFile(snapshotPath, "utf8");
    return normalizeSnapshot(JSON.parse(raw) as ConversationContext);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return readLegacyConversation(conversationsDir, ref);
    }
    throw error;
  }
}

async function readConversationBackup(
  conversationsDir: string,
  ref: ConversationRef,
  backupId: string,
): Promise<ConversationContext | undefined> {
  const backupPath = join(getConversationDir(conversationsDir, ref), backupId);

  try {
    const raw = await readFile(backupPath, "utf8");
    return normalizeSnapshot(JSON.parse(raw) as ConversationContext);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
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

async function writeConversationBackup(
  backupPath: string,
  snapshot: ConversationContext,
): Promise<void> {
  await mkdir(dirname(backupPath), { recursive: true });
  const backupFile = await open(backupPath, "wx", 0o600);

  try {
    await backupFile.writeFile(JSON.stringify(snapshot, null, 2), { encoding: "utf8" });
    await backupFile.chmod(0o600);
  } finally {
    await backupFile.close();
  }
}

async function removeActiveConversationFiles(conversationDir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(conversationDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.endsWith(".bak") || entry.name === "conversation.lock") {
        return;
      }

      await rm(join(conversationDir, entry.name), {
        recursive: entry.isDirectory(),
        force: true,
      });
    }),
  );
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

function resolveNextSnapshot(
  incoming: ConversationContext,
  current: ConversationContext | undefined,
): ConversationContext {
  const incomingVersion = getSnapshotVersion(incoming);

  if (!current) {
    if (incomingVersion !== 0) {
      throw new Error("Conversation write conflict: version mismatch");
    }

    return {
      ...incoming,
      state: {
        ...incoming.state,
        version: 1,
      },
    };
  }

  const currentVersion = getSnapshotVersion(current);

  if (incomingVersion > currentVersion) {
    throw new Error("Conversation write conflict: version mismatch");
  }

  if (incomingVersion === currentVersion) {
    return {
      ...incoming,
      state: {
        ...incoming.state,
        version: currentVersion + 1,
      },
    };
  }

  const mergedMessages = mergeConversationMessages(current.messages, incoming.messages);
  if (mergedMessages.length === current.messages.length) {
    throw new Error("Conversation write conflict: version mismatch");
  }

  return {
    ...current,
    messages: mergedMessages,
    state: {
      ...current.state,
      updatedAt: pickLatestTimestamp(current.state.updatedAt, incoming.state.updatedAt),
      version: currentVersion + 1,
    },
  };
}

function getSnapshotVersion(snapshot: ConversationContext): number {
  return snapshot.state.version ?? 0;
}

function mergeConversationMessages(
  currentMessages: ConversationMessage[],
  incomingMessages: ConversationMessage[],
): ConversationMessage[] {
  const mergedMessages = [...currentMessages];
  const currentMessagesById = new Map(currentMessages.map((message) => [message.id, message]));

  for (const message of incomingMessages) {
    const existing = currentMessagesById.get(message.id);
    if (!existing) {
      mergedMessages.push(message);
      currentMessagesById.set(message.id, message);
      continue;
    }

    if (!areMessagesEqual(existing, message)) {
      throw new Error(`Conversation write conflict: message "${message.id}" diverged`);
    }
  }

  return mergedMessages;
}

function areMessagesEqual(left: ConversationMessage, right: ConversationMessage): boolean {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.text === right.text &&
    left.createdAt === right.createdAt &&
    left.correlationId === right.correlationId
  );
}

function pickLatestTimestamp(left: string, right: string): string {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isNaN(leftTime)) {
    return right;
  }
  if (Number.isNaN(rightTime)) {
    return left;
  }

  return rightTime >= leftTime ? right : left;
}

async function withConversationWriteQueue<T>(
  ref: ConversationRef,
  action: () => Promise<T>,
): Promise<T> {
  const queueKey = getConversationKey(ref);
  const previous = conversationWriteQueues.get(queueKey) ?? Promise.resolve();
  let releaseQueue: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const next = previous.catch(() => undefined).then(() => current);

  conversationWriteQueues.set(queueKey, next);
  await previous.catch(() => undefined);

  try {
    return await action();
  } finally {
    releaseQueue?.();
    if (conversationWriteQueues.get(queueKey) === next) {
      conversationWriteQueues.delete(queueKey);
    }
  }
}

async function withConversationLock<T>(
  conversationsDir: string,
  ref: ConversationRef,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = getConversationLockPath(conversationsDir, ref);
  await mkdir(dirname(lockPath), { recursive: true });
  const release = await acquireConversationLock(lockPath);

  try {
    return await action();
  } finally {
    await release();
  }
}

async function acquireConversationLock(lockPath: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < lockRetryCount; attempt += 1) {
    try {
      const lockHandle = await open(lockPath, "wx");
      const lockPayload = {
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + lockTtlMs).toISOString(),
      };
      await lockHandle.writeFile(`${JSON.stringify(lockPayload, null, 2)}\n`, "utf8");
      await lockHandle.close();

      return async () => {
        try {
          await rm(lockPath);
        } catch (error) {
          if (!isMissingFile(error)) {
            throw error;
          }
        }
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      if (await tryCleanupExpiredLock(lockPath)) {
        continue;
      }

      await delay(lockRetryDelayMs);
    }
  }

  throw new Error(`Conversation write lock timed out: ${lockPath}`);
}

async function tryCleanupExpiredLock(lockPath: string): Promise<boolean> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const expiresAt = parseLockExpiry(raw);
    if (expiresAt !== undefined && expiresAt > Date.now()) {
      return false;
    }

    await rm(lockPath);
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return true;
    }

    if (isAlreadyExistsError(error)) {
      return false;
    }

    throw error;
  }
}

function parseLockExpiry(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw) as { expiresAt?: unknown };
    if (typeof parsed.expiresAt !== "string") {
      return undefined;
    }

    const expiresAt = Date.parse(parsed.expiresAt);
    return Number.isNaN(expiresAt) ? undefined : expiresAt;
  } catch {
    return undefined;
  }
}

function isConversationBackupFile(name: string): boolean {
  return /^conversation\.json\..+\.bak$/i.test(name);
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getConversationKey(ref: ConversationRef): string {
  return `${ref.transport}/${ref.externalId}`;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function sanitizePathSegment(value: string): string {
  return value.replaceAll("/", "_");
}
