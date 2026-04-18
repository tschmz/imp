import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type {
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
import { isAlreadyExistsError, isMissingFileError } from "../files/node-error.js";
import type { ConversationBackupSummary, ConversationStore } from "./types.js";

const conversationWriteQueues = new Map<string, Promise<void>>();
// The critical section is intentionally short: read latest snapshot, compute next state, atomically rename.
// A short-lived lock file guards that section across processes while the in-memory queue serializes writers locally.
const lockTtlMs = 30_000;
const lockRetryDelayMs = 25;
const lockRetryCount = 400;

function getChatDir(conversationsDir: string, ref: ChatRef): string {
  const endpointSegments = ref.endpointId
    ? ["endpoints", sanitizePathSegment(ref.endpointId)]
    : [];

  return join(
    conversationsDir,
    "chats",
    ...endpointSegments,
    sanitizePathSegment(ref.transport),
    sanitizePathSegment(ref.externalId),
  );
}

function getAgentDir(conversationsDir: string, agentId: string): string {
  return join(conversationsDir, "agents", sanitizePathSegment(agentId));
}

function getAgentSessionsDir(conversationsDir: string, agentId: string): string {
  return join(getAgentDir(conversationsDir, agentId), "sessions");
}

function getSessionDir(conversationsDir: string, ref: ConversationRef, agentId: string): string {
  const sessionId = requireSessionId(ref);
  return join(getAgentSessionsDir(conversationsDir, agentId), sanitizePathSegment(sessionId));
}

function getSessionSnapshotPath(conversationsDir: string, ref: ConversationRef, agentId: string): string {
  return join(getSessionDir(conversationsDir, ref, agentId), "conversation.json");
}

function getSelectedAgentPath(conversationsDir: string, ref: ChatRef): string {
  return join(getChatDir(conversationsDir, ref), "selected-agent.json");
}

function getAgentActiveSessionPath(conversationsDir: string, agentId: string): string {
  return join(getAgentDir(conversationsDir, agentId), "active.json");
}

function getAgentLockPath(conversationsDir: string, agentId: string): string {
  return join(getAgentDir(conversationsDir, agentId), "conversation.lock");
}

export function createFsConversationStore(paths: RuntimePaths): ConversationStore {
  return {
    async get(ref) {
      if ("sessionId" in ref) {
        return readSessionSnapshotBySessionId(ref, paths.conversationsDir);
      }

      const selectedAgentId = await readSelectedAgentId(paths.conversationsDir, ref);
      return selectedAgentId
        ? readActiveAgentConversation(paths.conversationsDir, selectedAgentId)
        : undefined;
    },
    async put(context) {
      await withAgentWriteQueue(context.state.agentId, async () => {
        await withAgentLock(paths.conversationsDir, context.state.agentId, async () => {
          const snapshotPath = getSessionSnapshotPath(
            paths.conversationsDir,
            context.state.conversation,
            context.state.agentId,
          );
          const current = await readSessionSnapshot(context.state.agentId, context.state.conversation, paths.conversationsDir);
          const nextSnapshot = resolveNextSnapshot(normalizeSnapshot(context, {
            conversationsDir: paths.conversationsDir,
            conversation: context.state.conversation,
            agentId: context.state.agentId,
            materializeAttachmentPaths: true,
          }), current);

          await writeFileAtomically(
            snapshotPath,
            JSON.stringify(toStorageSnapshot(nextSnapshot, paths.conversationsDir), null, 2),
          );
        });
      });
    },
    async listBackups(ref) {
      const selectedAgentId = await readSelectedAgentId(paths.conversationsDir, ref);
      return selectedAgentId ? readAgentInactiveSessions(paths.conversationsDir, selectedAgentId) : [];
    },
    async restore(ref, backupId) {
      const selectedAgentId = await readSelectedAgentId(paths.conversationsDir, ref);
      return selectedAgentId
        ? restoreAgentSession(paths.conversationsDir, selectedAgentId, backupId)
        : false;
    },
    async create(ref, options) {
      await writeSelectedAgentId(paths.conversationsDir, ref, options.agentId);
      return createAgentSession(paths.conversationsDir, ref, options);
    },
    async ensureActive(ref, options) {
      const selectedAgentId = await readSelectedAgentId(paths.conversationsDir, ref) ?? options.agentId;
      await writeSelectedAgentId(paths.conversationsDir, ref, selectedAgentId);
      return ensureActiveAgentSession(paths.conversationsDir, ref, {
        ...options,
        agentId: selectedAgentId,
      });
    },
    async getSelectedAgent(ref) {
      return readSelectedAgentId(paths.conversationsDir, ref);
    },
    async setSelectedAgent(ref, agentId) {
      await writeSelectedAgentId(paths.conversationsDir, ref, agentId);
    },
    async getActiveForAgent(agentId) {
      return readActiveAgentConversation(paths.conversationsDir, agentId);
    },
    async listBackupsForAgent(agentId) {
      return readAgentInactiveSessions(paths.conversationsDir, agentId);
    },
    async restoreForAgent(agentId, backupId) {
      return restoreAgentSession(paths.conversationsDir, agentId, backupId);
    },
    async createForAgent(ref, options) {
      await writeSelectedAgentId(paths.conversationsDir, ref, options.agentId);
      return createAgentSession(paths.conversationsDir, ref, options);
    },
    async ensureActiveForAgent(ref, options) {
      await writeSelectedAgentId(paths.conversationsDir, ref, options.agentId);
      return ensureActiveAgentSession(paths.conversationsDir, ref, options);
    },
  };
}

async function readAgentInactiveSessions(
  conversationsDir: string,
  agentId: string,
  activeSessionId?: string,
): Promise<ConversationBackupSummary[]> {
  const activeRef = activeSessionId
    ? undefined
    : await readActiveAgentConversationRef(conversationsDir, agentId);
  const sessionsDir = getAgentSessionsDir(conversationsDir, agentId);
  const resolvedActiveSessionId = activeSessionId ?? activeRef?.sessionId;
  let entries;

  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sessionId = entry.name;
        if (resolvedActiveSessionId && sessionId === resolvedActiveSessionId) {
          return undefined;
        }

        const snapshot = await readSessionSnapshotByAgentAndSessionId(agentId, sessionId, conversationsDir);
        return snapshot ? toBackupSummary(snapshot) : undefined;
      }),
  );

  return backups
    .filter((backup): backup is ConversationBackupSummary => backup !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function createAgentSession(
  conversationsDir: string,
  ref: ChatRef,
  options: { agentId: string; now: string; title?: string },
): Promise<ConversationContext> {
  return withAgentWriteQueue(options.agentId, async () =>
    withAgentLock(conversationsDir, options.agentId, async () => {
      const context = createEmptyConversationContext(ref, options);

      await writeConversationSnapshot(conversationsDir, context);
      await writeActiveAgentConversationRef(conversationsDir, context.state.agentId, context.state.conversation);
      return context;
    }),
  );
}

async function ensureActiveAgentSession(
  conversationsDir: string,
  ref: ChatRef,
  options: { agentId: string; now: string; title?: string },
): Promise<ConversationContext> {
  return withAgentWriteQueue(options.agentId, async () =>
    withAgentLock(conversationsDir, options.agentId, async () => {
      const activeRef = await readActiveAgentConversationRef(conversationsDir, options.agentId);
      if (activeRef) {
        const existing = await readSessionSnapshot(options.agentId, activeRef, conversationsDir);
        if (existing) {
          return existing;
        }
      }

      const created = createEmptyConversationContext(ref, options);
      await writeConversationSnapshot(conversationsDir, created);
      await writeActiveAgentConversationRef(conversationsDir, options.agentId, created.state.conversation);
      return created;
    }),
  );
}

async function restoreAgentSession(
  conversationsDir: string,
  agentId: string,
  backupId: string,
): Promise<boolean> {
  return withAgentWriteQueue(agentId, async () =>
    withAgentLock(conversationsDir, agentId, async () => {
      const summaries = await readAgentInactiveSessions(conversationsDir, agentId);
      const selected = summaries.find((summary) => summary.id === backupId);
      if (!selected) {
        return false;
      }

      await writeActiveAgentConversationRef(conversationsDir, agentId, {
        transport: selected.transport ?? "_",
        externalId: selected.externalId ?? "_",
        sessionId: selected.sessionId,
      });
      return true;
    }),
  );
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
  }, {
    conversationsDir: "",
    conversation,
    agentId: options.agentId,
    materializeAttachmentPaths: false,
  });
}

async function writeConversationSnapshot(
  conversationsDir: string,
  context: ConversationContext,
): Promise<void> {
  const snapshotPath = getSessionSnapshotPath(
    conversationsDir,
    context.state.conversation,
    context.state.agentId,
  );
  await writeFileAtomically(
    snapshotPath,
    JSON.stringify(toStorageSnapshot(context, conversationsDir), null, 2),
  );
}

function toBackupSummary(snapshot: ConversationContext): ConversationBackupSummary {
  const sessionId = requireSessionId(snapshot.state.conversation);
  return {
    id: sessionId,
    sessionId,
    transport: snapshot.state.conversation.transport,
    externalId: snapshot.state.conversation.externalId,
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
  agentId: string,
  ref: ConversationRef,
  conversationsDir: string,
): Promise<ConversationContext | undefined> {
  const snapshotPath = getSessionSnapshotPath(conversationsDir, ref, agentId);

  try {
    const raw = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as ConversationContext;
    return normalizeSnapshot(parsed, {
      conversationsDir,
      conversation: parsed.state?.conversation ?? ref,
      agentId,
      materializeAttachmentPaths: true,
    });
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readSessionSnapshotByAgentAndSessionId(
  agentId: string,
  sessionId: string,
  conversationsDir: string,
): Promise<ConversationContext | undefined> {
  return readSessionSnapshot(agentId, {
    transport: "_",
    externalId: "_",
    sessionId,
  }, conversationsDir);
}

async function readSessionSnapshotBySessionId(
  ref: ConversationRef,
  conversationsDir: string,
): Promise<ConversationContext | undefined> {
  const sessionId = requireSessionId(ref);
  let entries;

  try {
    entries = await readdir(join(conversationsDir, "agents"), { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const snapshot = await readSessionSnapshotByAgentAndSessionId(entry.name, sessionId, conversationsDir);
    if (snapshot) {
      return snapshot;
    }
  }

  return undefined;
}

async function readSelectedAgentId(
  conversationsDir: string,
  ref: ChatRef,
): Promise<string | undefined> {
  const selectedAgentPath = getSelectedAgentPath(conversationsDir, ref);

  try {
    const raw = await readFile(selectedAgentPath, "utf8");
    const parsed = JSON.parse(raw) as { agentId?: unknown };
    if (typeof parsed.agentId !== "string" || parsed.agentId.length === 0) {
      return undefined;
    }

    return parsed.agentId;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function writeSelectedAgentId(
  conversationsDir: string,
  ref: ChatRef,
  agentId: string,
): Promise<void> {
  const selectedAgentPath = getSelectedAgentPath(conversationsDir, ref);
  await writeFileAtomically(selectedAgentPath, `${JSON.stringify({ agentId }, null, 2)}\n`);
}

async function readActiveAgentConversation(
  conversationsDir: string,
  agentId: string,
): Promise<ConversationContext | undefined> {
  const activeRef = await readActiveAgentConversationRef(conversationsDir, agentId);
  return activeRef ? readSessionSnapshot(agentId, activeRef, conversationsDir) : undefined;
}

async function readActiveAgentConversationRef(
  conversationsDir: string,
  agentId: string,
): Promise<ConversationRef | undefined> {
  const activePath = getAgentActiveSessionPath(conversationsDir, agentId);

  try {
    const raw = await readFile(activePath, "utf8");
    const parsed = JSON.parse(raw) as {
      transport?: unknown;
      externalId?: unknown;
      sessionId?: unknown;
    };
    if (
      typeof parsed.transport !== "string" ||
      typeof parsed.externalId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.length === 0
    ) {
      return undefined;
    }

    return {
      transport: parsed.transport,
      externalId: parsed.externalId,
      sessionId: parsed.sessionId,
    };
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function writeActiveAgentConversationRef(
  conversationsDir: string,
  agentId: string,
  ref: ConversationRef,
): Promise<void> {
  const activePath = getAgentActiveSessionPath(conversationsDir, agentId);
  await writeFileAtomically(
    activePath,
    `${JSON.stringify({
      transport: ref.transport,
      externalId: ref.externalId,
      sessionId: ref.sessionId,
    }, null, 2)}\n`,
  );
}

async function writeFileAtomically(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.tmp`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}

function normalizeSnapshot(
  snapshot: ConversationContext,
  options: {
    conversationsDir: string;
    conversation: ConversationRef;
    agentId: string;
    materializeAttachmentPaths: boolean;
  },
): ConversationContext {
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      version: snapshot.state.version ?? 0,
    },
    messages: snapshot.messages.map((message) => normalizeConversationEvent(message, options)),
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

function normalizeConversationEvent(
  message: unknown,
  options: {
    conversationsDir: string;
    conversation: ConversationRef;
    agentId: string;
    materializeAttachmentPaths: boolean;
  },
): ConversationEvent {
  if (isConversationUserMessage(message)) {
    return normalizeConversationUserMessage(message, options);
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
  options: {
    conversationsDir: string;
    conversation: ConversationRef;
    agentId: string;
    materializeAttachmentPaths: boolean;
  },
): ConversationUserMessage {
  const source = normalizeConversationMessageSource(message, options);

  return {
    ...message,
    kind: "message",
    content: normalizeUserContent(message.content),
    ...(source ? { source } : {}),
  };
}

function normalizeConversationMessageSource(
  message: ConversationUserMessage,
  options: {
    conversationsDir: string;
    conversation: ConversationRef;
    agentId: string;
    materializeAttachmentPaths: boolean;
  },
): ConversationUserMessage["source"] {
  if (message.source?.kind !== "telegram-document" || !message.source.document) {
    return message.source;
  }

  const document = message.source.document;
  const relativePath = normalizeAttachmentRelativePath(
    document.relativePath ?? inferAttachmentRelativePath(message, options.conversation),
  );
  const savedPath =
    options.materializeAttachmentPaths && relativePath
      ? materializeAttachmentPath(options.conversationsDir, options.conversation, options.agentId, relativePath)
      : document.savedPath;

  return {
    ...message.source,
    document: {
      ...document,
      ...(relativePath ? { relativePath } : {}),
      ...(savedPath ? { savedPath } : {}),
    },
  };
}

function toStorageSnapshot(context: ConversationContext, conversationsDir: string): ConversationContext {
  return {
    ...context,
    messages: context.messages.map((message) => {
      if (message.role !== "user" || message.source?.kind !== "telegram-document" || !message.source.document) {
        return message;
      }

      const relativePath = normalizeAttachmentRelativePath(
        message.source.document.relativePath ??
          getAttachmentRelativePathFromSavedPath(
            conversationsDir,
            context.state.conversation,
            context.state.agentId,
            message,
          ),
      );
      const document = {
        ...message.source.document,
        ...(relativePath ? { relativePath } : {}),
      };
      delete document.savedPath;

      return {
        ...message,
        source: {
          ...message.source,
          document,
        },
      };
    }),
  };
}

function getAttachmentRelativePathFromSavedPath(
  conversationsDir: string,
  conversation: ConversationRef,
  agentId: string,
  message: ConversationUserMessage,
): string | undefined {
  const savedPath = message.source?.document?.savedPath;
  if (!savedPath || !isAbsolute(savedPath)) {
    return savedPath;
  }

  const sessionDir = getSessionDir(conversationsDir, conversation, agentId);
  const pathRelativeToSession = relative(sessionDir, savedPath);
  if (pathRelativeToSession && !pathRelativeToSession.startsWith("..") && !isAbsolute(pathRelativeToSession)) {
    return pathRelativeToSession;
  }

  return inferAttachmentRelativePath(message, conversation);
}

function inferAttachmentRelativePath(
  message: ConversationUserMessage,
  conversation: ConversationRef,
): string | undefined {
  const savedPath = message.source?.document?.savedPath;
  if (!savedPath) {
    return undefined;
  }

  const normalized = savedPath.replaceAll("\\", "/");
  const marker = `/sessions/${conversation.sessionId}/`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }

  return undefined;
}

function materializeAttachmentPath(
  conversationsDir: string,
  conversation: ConversationRef,
  agentId: string,
  relativePath: string,
): string {
  return join(
    getSessionDir(conversationsDir, conversation, agentId),
    ...relativePath.split(/[\\/]+/).filter(Boolean),
  );
}

function normalizeAttachmentRelativePath(relativePath: string | undefined): string | undefined {
  if (!relativePath) {
    return undefined;
  }

  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === "..")) {
    return undefined;
  }

  return normalized;
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
    stopReason: message.stopReason,
    timestamp: normalizeTimestamp(message.timestamp, message.createdAt),
  };
}

function normalizeConversationToolResultMessage(
  message: ConversationToolResultMessage & { isError?: boolean },
): ConversationToolResultMessage {
  return {
    ...message,
    kind: "message",
    content: normalizeToolResultContent(message.content),
    timestamp: normalizeTimestamp(message.timestamp, message.createdAt),
    isError: message.isError ?? false,
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

function isConversationUserMessage(message: unknown): message is ConversationUserMessage {
  return hasMessageRole(message, "user") && hasProperty(message, "content");
}

function isConversationAssistantMessage(message: unknown): message is ConversationAssistantMessage {
  return hasMessageRole(message, "assistant") && hasProperty(message, "content");
}

function isConversationToolResultMessage(message: unknown): message is ConversationToolResultMessage {
  return hasMessageRole(message, "toolResult") && hasProperty(message, "content");
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

async function withAgentWriteQueue<T>(
  agentId: string,
  action: () => Promise<T>,
): Promise<T> {
  return withWriteQueue(`agent/${agentId}`, action);
}

async function withWriteQueue<T>(
  queueKey: string,
  action: () => Promise<T>,
): Promise<T> {
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

async function withAgentLock<T>(
  conversationsDir: string,
  agentId: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = getAgentLockPath(conversationsDir, agentId);
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
          if (!isMissingFileError(error)) {
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
    if (isMissingFileError(error)) {
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

function sanitizePathSegment(value: string): string {
  const sanitized = value.replaceAll(/[\\/]/g, "_");
  return sanitized.length === 0 || sanitized === "." || sanitized === ".." ? "_" : sanitized;
}

function requireSessionId(ref: ConversationRef): string {
  if (!ref.sessionId) {
    throw new Error("Conversation sessionId is required");
  }

  return ref.sessionId;
}
