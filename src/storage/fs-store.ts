import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type {
  ChatRef,
  ConversationAssistantMessage,
  ConversationContext,
  ConversationEvent,
  ConversationRef,
  ConversationToolResultMessage,
  ConversationUserMessage,
} from "../domain/conversation.js";
import type { RuntimePaths } from "../daemon/types.js";
import type { ConversationBackupSummary, ConversationStore } from "./types.js";

const conversationWriteQueues = new Map<string, Promise<void>>();
const legacySessionId = "legacy";
// The critical section is intentionally short: read latest snapshot, compute next state, atomically rename.
// A short-lived lock file guards that section across processes while the in-memory queue serializes writers locally.
const lockTtlMs = 30_000;
const lockRetryDelayMs = 25;
const lockRetryCount = 400;
const LEGACY_ASSISTANT_REPLAY_SOURCE = {
  api: "legacy",
  provider: "legacy",
  model: "legacy",
} as const;
const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function getChatDir(conversationsDir: string, ref: ChatRef): string {
  return join(
    conversationsDir,
    sanitizePathSegment(ref.transport),
    sanitizePathSegment(ref.externalId),
  );
}

function getSessionsDir(conversationsDir: string, ref: ChatRef): string {
  return join(getChatDir(conversationsDir, ref), "sessions");
}

function getSessionDir(conversationsDir: string, ref: ConversationRef): string {
  const sessionId = requireSessionId(ref);
  return join(getSessionsDir(conversationsDir, ref), sanitizePathSegment(sessionId));
}

function getSessionSnapshotPath(conversationsDir: string, ref: ConversationRef): string {
  return join(getSessionDir(conversationsDir, ref), "conversation.json");
}

function getActiveSessionPath(conversationsDir: string, ref: ChatRef): string {
  return join(getChatDir(conversationsDir, ref), "active.json");
}

function getConversationLockPath(conversationsDir: string, ref: ChatRef): string {
  return join(getChatDir(conversationsDir, ref), "conversation.lock");
}

export function createFsConversationStore(paths: RuntimePaths): ConversationStore {
  return {
    async get(ref) {
      if ("sessionId" in ref) {
        return readSessionSnapshot(ref, paths.conversationsDir);
      }

      return withConversationWriteQueue(ref, async () =>
        withConversationLock(paths.conversationsDir, ref, async () => {
          await migrateLegacyConversationIfNeeded(paths.conversationsDir, ref);
          const activeRef = await readActiveConversationRef(paths.conversationsDir, ref);
          if (!activeRef) {
            return undefined;
          }

          return readSessionSnapshot(activeRef, paths.conversationsDir);
        }),
      );
    },
    async put(context) {
      await withConversationWriteQueue(context.state.conversation, async () => {
        await withConversationLock(paths.conversationsDir, context.state.conversation, async () => {
          const snapshotPath = getSessionSnapshotPath(
            paths.conversationsDir,
            context.state.conversation,
          );
          const current = await readSessionSnapshot(context.state.conversation, paths.conversationsDir);
          const nextSnapshot = resolveNextSnapshot(normalizeSnapshot(context), current);
          const tempPath = `${snapshotPath}.${process.pid}.tmp`;

          await mkdir(dirname(snapshotPath), { recursive: true });
          await writeFile(tempPath, JSON.stringify(nextSnapshot, null, 2));
          await rename(tempPath, snapshotPath);
        });
      });
    },
    async listBackups(ref) {
      return withConversationWriteQueue(ref, async () =>
        withConversationLock(paths.conversationsDir, ref, async () => {
          await migrateLegacyConversationIfNeeded(paths.conversationsDir, ref);
          const activeRef = await readActiveConversationRef(paths.conversationsDir, ref);
          return readInactiveSessions(paths.conversationsDir, ref, activeRef?.sessionId);
        }),
      );
    },
    async restore(ref, backupId) {
      return withConversationWriteQueue(ref, async () =>
        withConversationLock(paths.conversationsDir, ref, async () => {
          await migrateLegacyConversationIfNeeded(paths.conversationsDir, ref);
          const summaries = await readInactiveSessions(paths.conversationsDir, ref);
          const selected = summaries.find((summary) => summary.id === backupId);
          if (!selected) {
            return false;
          }

          await writeActiveConversationRef(paths.conversationsDir, {
            transport: ref.transport,
            externalId: ref.externalId,
            sessionId: selected.sessionId,
          });
          return true;
        }),
      );
    },
    async create(ref, options) {
      return withConversationWriteQueue(ref, async () =>
        withConversationLock(paths.conversationsDir, ref, async () => {
          await migrateLegacyConversationIfNeeded(paths.conversationsDir, ref);
          const context = createEmptyConversationContext(ref, options);

          await writeConversationSnapshot(paths.conversationsDir, context);
          await writeActiveConversationRef(paths.conversationsDir, context.state.conversation);
          return context;
        }),
      );
    },
    async ensureActive(ref, options) {
      return withConversationWriteQueue(ref, async () =>
        withConversationLock(paths.conversationsDir, ref, async () => {
          await migrateLegacyConversationIfNeeded(paths.conversationsDir, ref);
          const activeRef = await readActiveConversationRef(paths.conversationsDir, ref);
          if (activeRef) {
            const existing = await readSessionSnapshot(activeRef, paths.conversationsDir);
            if (existing) {
              return existing;
            }
          }

          const created = createEmptyConversationContext(ref, options);
          await writeConversationSnapshot(paths.conversationsDir, created);
          await writeActiveConversationRef(paths.conversationsDir, created.state.conversation);
          return created;
        }),
      );
    },
  };
}

async function readInactiveSessions(
  conversationsDir: string,
  ref: ChatRef,
  activeSessionId?: string,
): Promise<ConversationBackupSummary[]> {
  const sessionsDir = getSessionsDir(conversationsDir, ref);
  let entries;

  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sessionId = entry.name;
        if (activeSessionId && sessionId === activeSessionId) {
          return undefined;
        }

        const snapshot = await readSessionSnapshot(pathsafeRef(ref, sessionId), conversationsDir);
        return snapshot ? toBackupSummary(snapshot) : undefined;
      }),
  );

  return backups
    .filter((backup): backup is ConversationBackupSummary => backup !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function createEmptyConversationContext(
  ref: ChatRef,
  options: { agentId: string; now: string; title?: string },
): ConversationContext {
  const conversation: ConversationRef = {
    transport: ref.transport,
    externalId: ref.externalId,
    sessionId: randomUUID(),
  };

  return normalizeSnapshot({
    state: {
      conversation,
      agentId: options.agentId,
      ...(typeof options.title === "string" ? { title: options.title } : {}),
      createdAt: options.now,
      updatedAt: options.now,
      version: 1,
    },
    messages: [],
  });
}

async function writeConversationSnapshot(
  conversationsDir: string,
  context: ConversationContext,
): Promise<void> {
  const snapshotPath = getSessionSnapshotPath(conversationsDir, context.state.conversation);
  const tempPath = `${snapshotPath}.${process.pid}.tmp`;

  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(context, null, 2));
  await rename(tempPath, snapshotPath);
}

function pathsafeRef(ref: ChatRef, sessionId: string): ConversationRef {
  return {
    transport: ref.transport,
    externalId: ref.externalId,
    sessionId,
  };
}

function toBackupSummary(snapshot: ConversationContext): ConversationBackupSummary {
  const sessionId = snapshot.state.conversation.sessionId ?? legacySessionId;
  return {
    id: sessionId,
    sessionId,
    ...(snapshot.state.title ? { title: snapshot.state.title } : {}),
    createdAt: snapshot.state.createdAt,
    updatedAt: snapshot.state.updatedAt,
    agentId: snapshot.state.agentId,
    messageCount: snapshot.messages.length,
    ...(snapshot.state.workingDirectory
      ? { workingDirectory: snapshot.state.workingDirectory }
      : {}),
  };
}

async function readSessionSnapshot(
  ref: ConversationRef,
  conversationsDir: string,
): Promise<ConversationContext | undefined> {
  const snapshotPath = getSessionSnapshotPath(conversationsDir, ref);

  try {
    const raw = await readFile(snapshotPath, "utf8");
    return normalizeSnapshot(JSON.parse(raw) as ConversationContext);
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readActiveConversationRef(
  conversationsDir: string,
  ref: ChatRef,
): Promise<ConversationRef | undefined> {
  const activePath = getActiveSessionPath(conversationsDir, ref);

  try {
    const raw = await readFile(activePath, "utf8");
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    if (typeof parsed.sessionId !== "string" || parsed.sessionId.length === 0) {
      return undefined;
    }

    return {
      transport: ref.transport,
      externalId: ref.externalId,
      sessionId: parsed.sessionId,
    };
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

async function writeActiveConversationRef(
  conversationsDir: string,
  ref: ConversationRef,
): Promise<void> {
  const activePath = getActiveSessionPath(conversationsDir, ref);
  const tempPath = `${activePath}.${process.pid}.tmp`;

  await mkdir(dirname(activePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify({ sessionId: ref.sessionId }, null, 2)}\n`, "utf8");
  await rename(tempPath, activePath);
}

async function migrateLegacyConversationIfNeeded(
  conversationsDir: string,
  ref: ChatRef,
): Promise<void> {
  const activeRef = await readActiveConversationRef(conversationsDir, ref);
  if (activeRef) {
    return;
  }

  const legacy = await readLegacyConversation(conversationsDir, ref);
  if (!legacy) {
    return;
  }

  const migratedRef: ConversationRef = {
    transport: ref.transport,
    externalId: ref.externalId,
    sessionId: legacySessionId,
  };
  const migrated: ConversationContext = normalizeSnapshot({
    ...legacy,
    state: {
      ...legacy.state,
      conversation: migratedRef,
    },
  });
  const snapshotPath = getSessionSnapshotPath(conversationsDir, migratedRef);
  const tempPath = `${snapshotPath}.${process.pid}.tmp`;

  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(migrated, null, 2));
  await rename(tempPath, snapshotPath);
  await writeActiveConversationRef(conversationsDir, migratedRef);
}

async function readLegacyConversation(
  conversationsDir: string,
  ref: ChatRef,
): Promise<ConversationContext | undefined> {
  const snapshotPath = join(getChatDir(conversationsDir, ref), "conversation.json");
  try {
    const raw = await readFile(snapshotPath, "utf8");
    return normalizeSnapshot(JSON.parse(raw) as ConversationContext);
  } catch (error: unknown) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  const statePath = join(getChatDir(conversationsDir, ref), "meta.json");

  try {
    const raw = await readFile(statePath, "utf8");
    const state = JSON.parse(raw) as Omit<ConversationContext["state"], "conversation"> & {
      conversation?: unknown;
    };
    const messages = await readLegacyMessages(conversationsDir, ref);
    return normalizeSnapshot({
      state: {
        conversation: {
          transport: ref.transport,
          externalId: ref.externalId,
          sessionId: legacySessionId,
        },
        agentId: state.agentId,
        ...(typeof state.title === "string" ? { title: state.title } : {}),
        ...(typeof state.workingDirectory === "string"
          ? { workingDirectory: state.workingDirectory }
          : {}),
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        version: state.version,
      },
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
  ref: ChatRef,
): Promise<ConversationEvent[]> {
  const path = join(getChatDir(conversationsDir, ref), "messages.json");

  try {
    const raw = await readFile(path, "utf8");
    return (JSON.parse(raw) as unknown[]).map((message) =>
      normalizeConversationEvent(message as ConversationEvent),
    );
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
    messages: snapshot.messages.map((message) => normalizeConversationEvent(message)),
  };
}

function resolveNextSnapshot(
  incoming: ConversationContext,
  current: ConversationContext | undefined,
): ConversationContext {
  const incomingVersion = getSnapshotVersion(incoming);

  if (!current) {
    if (incomingVersion !== 0 && incomingVersion !== 1) {
      throw new Error("Conversation write conflict: version mismatch");
    }

    return {
      ...incoming,
      state: {
        ...incoming.state,
        version: incomingVersion === 0 ? 1 : incomingVersion,
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
  currentMessages: ConversationEvent[],
  incomingMessages: ConversationEvent[],
): ConversationEvent[] {
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

function areMessagesEqual(left: ConversationEvent, right: ConversationEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeConversationEvent(message: unknown): ConversationEvent {
  if (isLegacyToolCallEvent(message)) {
    return normalizeLegacyToolCallEvent(message);
  }

  if (isLegacyToolResultEvent(message)) {
    return normalizeLegacyToolResultEvent(message);
  }

  if (isLegacyUserMessage(message)) {
    return normalizeLegacyUserMessage(message);
  }

  if (isLegacyAssistantMessage(message)) {
    return normalizeLegacyAssistantMessage(message);
  }

  if (isConversationUserMessage(message)) {
    return normalizeConversationUserMessage(message);
  }

  if (isConversationAssistantMessage(message)) {
    return normalizeConversationAssistantMessage(message);
  }

  if (isConversationToolResultMessage(message)) {
    return normalizeConversationToolResultMessage(message);
  }

  throw new Error("Unsupported conversation event shape");
}

function normalizeConversationUserMessage(
  message: ConversationUserMessage,
): ConversationUserMessage {
  return {
    ...message,
    kind: "message",
    content: normalizeUserContent(message.content),
  };
}

function normalizeConversationAssistantMessage(
  message: ConversationAssistantMessage,
): ConversationAssistantMessage {
  return {
    ...message,
    kind: "message",
    content: message.content.map((content) =>
      content.type === "toolCall"
        ? {
            ...content,
            arguments: content.arguments ?? {},
          }
        : content,
    ),
    usage: message.usage ?? EMPTY_USAGE,
    stopReason: message.stopReason ?? inferAssistantStopReason(message),
    timestamp: normalizeTimestamp(message.timestamp, message.createdAt),
    ...(message.api ? {} : LEGACY_ASSISTANT_REPLAY_SOURCE),
    ...(message.provider ? {} : { provider: LEGACY_ASSISTANT_REPLAY_SOURCE.provider }),
    ...(message.model ? {} : { model: LEGACY_ASSISTANT_REPLAY_SOURCE.model }),
  };
}

function normalizeConversationToolResultMessage(
  message: ConversationToolResultMessage,
): ConversationToolResultMessage {
  return {
    ...message,
    kind: "message",
    content: normalizeToolResultContent(message.content),
    timestamp: normalizeTimestamp(message.timestamp, message.createdAt),
  };
}

function normalizeLegacyUserMessage(
  message: {
    id: string;
    createdAt: string;
    correlationId?: string;
    role: "user";
    text: string;
    source?: ConversationUserMessage["source"];
  },
): ConversationUserMessage {
  return {
    kind: "message",
    id: message.id,
    role: "user",
    content: message.text,
    createdAt: message.createdAt,
    timestamp: normalizeTimestamp(undefined, message.createdAt),
    ...(message.correlationId ? { correlationId: message.correlationId } : {}),
    ...(message.source ? { source: message.source } : {}),
  };
}

function normalizeLegacyAssistantMessage(
  message: {
    id: string;
    createdAt: string;
    correlationId?: string;
    role: "assistant";
    text: string;
  },
): ConversationAssistantMessage {
  return {
    kind: "message",
    id: message.id,
    role: "assistant",
    content: [{ type: "text", text: message.text }],
    createdAt: message.createdAt,
    timestamp: normalizeTimestamp(undefined, message.createdAt),
    ...(message.correlationId ? { correlationId: message.correlationId } : {}),
    ...LEGACY_ASSISTANT_REPLAY_SOURCE,
    usage: EMPTY_USAGE,
    stopReason: "stop",
  };
}

function normalizeLegacyToolCallEvent(
  message: {
    kind: "tool-call";
    id: string;
    createdAt: string;
    correlationId?: string;
    text?: string;
    toolCalls: Array<{
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }>;
  },
): ConversationAssistantMessage {
  return {
    kind: "message",
    id: message.id,
    role: "assistant",
    createdAt: message.createdAt,
    timestamp: normalizeTimestamp(undefined, message.createdAt),
    ...(message.correlationId ? { correlationId: message.correlationId } : {}),
    ...LEGACY_ASSISTANT_REPLAY_SOURCE,
    usage: EMPTY_USAGE,
    stopReason: "toolUse",
    content: [
      ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
      ...message.toolCalls.map((toolCall) => ({
        type: "toolCall" as const,
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments ?? {},
      })),
    ],
  };
}

function normalizeLegacyToolResultEvent(
  message: {
    kind: "tool-result";
    id: string;
    createdAt: string;
    correlationId?: string;
    toolCallId: string;
    toolName: string;
    content?: ToolResultMessage["content"];
    details?: unknown;
    isError: boolean;
  },
): ConversationToolResultMessage {
  return {
    kind: "message",
    id: message.id,
    role: "toolResult",
    createdAt: message.createdAt,
    timestamp: normalizeTimestamp(undefined, message.createdAt),
    ...(message.correlationId ? { correlationId: message.correlationId } : {}),
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: normalizeToolResultContent(message.content),
    ...(message.details !== undefined ? { details: message.details } : {}),
    isError: message.isError,
  };
}

function normalizeUserContent(content: UserMessage["content"] | undefined): UserMessage["content"] {
  if (content === undefined) {
    return "";
  }

  return typeof content === "string" ? content : normalizeToolResultContent(content);
}

function normalizeToolResultContent(
  content: ToolResultMessage["content"] | UserMessage["content"] | undefined,
): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
  if (!Array.isArray(content)) {
    return [];
  }

  return content;
}

function normalizeTimestamp(timestamp: number | undefined, createdAt: string): number {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }

  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function inferAssistantStopReason(
  message: Pick<ConversationAssistantMessage, "content"> & Partial<Pick<ConversationAssistantMessage, "errorMessage">>,
): AssistantMessage["stopReason"] {
  if (message.errorMessage !== undefined) {
    return "error";
  }

  return message.content.some((content) => content.type === "toolCall") ? "toolUse" : "stop";
}

function isLegacyUserMessage(
  message: unknown,
): message is {
  id: string;
  createdAt: string;
  correlationId?: string;
  role: "user";
  text: string;
  source?: ConversationUserMessage["source"];
} {
  return hasMessageRole(message, "user") && hasProperty(message, "text");
}

function isLegacyAssistantMessage(
  message: unknown,
): message is {
  id: string;
  createdAt: string;
  correlationId?: string;
  role: "assistant";
  text: string;
} {
  return hasMessageRole(message, "assistant") && hasProperty(message, "text");
}

function isLegacyToolCallEvent(
  message: unknown,
): message is {
  kind: "tool-call";
  id: string;
  createdAt: string;
  correlationId?: string;
  text?: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
  }>;
} {
  return hasKind(message, "tool-call");
}

function isLegacyToolResultEvent(
  message: unknown,
): message is {
  kind: "tool-result";
  id: string;
  createdAt: string;
  correlationId?: string;
  toolCallId: string;
  toolName: string;
  content?: ToolResultMessage["content"];
  details?: unknown;
  isError: boolean;
} {
  return hasKind(message, "tool-result");
}

function isConversationUserMessage(message: unknown): message is ConversationUserMessage {
  return hasMessageRole(message, "user") && hasProperty(message, "content");
}

function isConversationAssistantMessage(message: unknown): message is ConversationAssistantMessage {
  return hasMessageRole(message, "assistant") && hasProperty(message, "content");
}

function isConversationToolResultMessage(message: unknown): message is ConversationToolResultMessage {
  return hasMessageRole(message, "toolResult") && hasProperty(message, "content");
}

function hasKind(message: unknown, kind: string): boolean {
  return typeof message === "object" && message !== null && "kind" in message && message.kind === kind;
}

function hasMessageRole(message: unknown, role: string): boolean {
  return typeof message === "object" && message !== null && "role" in message && message.role === role;
}

function hasProperty(message: unknown, property: string): boolean {
  return typeof message === "object" && message !== null && property in message;
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
  ref: ChatRef | ConversationRef,
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
  ref: ChatRef,
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

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getConversationKey(ref: ChatRef | ConversationRef): string {
  return "sessionId" in ref
    ? `${ref.transport}/${ref.externalId}/${ref.sessionId}`
    : `${ref.transport}/${ref.externalId}`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function sanitizePathSegment(value: string): string {
  return value.replaceAll("/", "_");
}

function requireSessionId(ref: ConversationRef): string {
  if (!ref.sessionId) {
    throw new Error("Conversation sessionId is required");
  }

  return ref.sessionId;
}
