import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type {
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import { lock as lockFile } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { createKeyedSerialTaskQueue } from "../concurrency/async-primitives.js";
import type {
  ChatRef,
  ConversationAssistantMessage,
  ConversationContext,
  ConversationEvent,
  ConversationRef,
  ConversationState,
  ConversationSystemPromptSnapshot,
  ConversationToolResultMessage,
  ConversationUserMessage,
} from "../domain/conversation.js";
import type { RuntimePaths } from "../daemon/types.js";
import { isMissingFileError } from "../files/node-error.js";
import type { ConversationBackupSummary, ConversationStore } from "./types.js";

interface StoredConversationMeta extends ConversationState {
  messageCount?: number;
}

const conversationWriteQueues = createKeyedSerialTaskQueue<string>();
const lockTtlMs = 30_000;
const lockRetryDelayMs = 25;
const lockRetryCount = 400;

function getBindingDir(bindingsDir: string, ref: ChatRef): string {
  return join(
    bindingsDir,
    sanitizePathSegment(ref.endpointId ?? "_"),
    sanitizePathSegment(ref.transport),
    sanitizePathSegment(ref.externalId),
  );
}

function getAgentDir(sessionsDir: string, agentId: string): string {
  return join(sessionsDir, sanitizePathSegment(agentId));
}

function getAgentEntriesDir(sessionsDir: string, agentId: string): string {
  return join(getAgentDir(sessionsDir, agentId), "entries");
}

function getSessionDir(sessionsDir: string, ref: ConversationRef, agentId: string): string {
  const sessionId = requireSessionId(ref);
  return join(getAgentEntriesDir(sessionsDir, agentId), sanitizePathSegment(sessionId));
}

function getSessionMetaPath(sessionsDir: string, ref: ConversationRef, agentId: string): string {
  return join(getSessionDir(sessionsDir, ref, agentId), "meta.json");
}

function getSessionEventsPath(sessionsDir: string, ref: ConversationRef, agentId: string): string {
  return join(getSessionDir(sessionsDir, ref, agentId), "events.jsonl");
}

function getSystemPromptsDir(sessionsDir: string, ref: ConversationRef, agentId: string): string {
  return join(getSessionDir(sessionsDir, ref, agentId), "system-prompts");
}

function getSelectedAgentPath(bindingsDir: string, ref: ChatRef): string {
  return join(getBindingDir(bindingsDir, ref), "selected-agent.json");
}

function getAgentActiveSessionPath(sessionsDir: string, agentId: string): string {
  return join(getAgentDir(sessionsDir, agentId), "active.json");
}

function getAgentLockPath(sessionsDir: string, agentId: string): string {
  return join(getAgentDir(sessionsDir, agentId), "sessions.lock");
}

export function createFsConversationStore(paths: RuntimePaths): ConversationStore {
  return {
    async get(ref) {
      if ("sessionId" in ref) {
        return readSessionBySessionId(ref, paths.sessionsDir);
      }

      const selectedAgentId = await readSelectedAgentId(paths.bindingsDir, ref);
      return selectedAgentId
        ? readActiveAgentConversation(paths.sessionsDir, selectedAgentId)
        : undefined;
    },
    async put(context) {
      await withAgentWriteQueue(context.state.agentId, async () => {
        await withAgentLock(paths.sessionsDir, context.state.agentId, async () => {
          const currentMeta = await readSessionMeta(
            context.state.agentId,
            context.state.conversation,
            paths.sessionsDir,
          );
          await writeConversationLog(paths.sessionsDir, normalizeContext({
            ...context,
            state: {
              ...context.state,
              version: currentMeta ? (currentMeta.version ?? 0) + 1 : context.state.version,
            },
          }, {
            sessionsDir: paths.sessionsDir,
            conversation: context.state.conversation,
            agentId: context.state.agentId,
            materializeAttachmentPaths: true,
          }));
        });
      });
    },
    async appendEvents(context, events) {
      return withAgentWriteQueue(context.state.agentId, async () =>
        withAgentLock(paths.sessionsDir, context.state.agentId, async () =>
          appendConversationEvents(paths.sessionsDir, context, events),
        ),
      );
    },
    async updateState(context, patch) {
      return withAgentWriteQueue(context.state.agentId, async () =>
        withAgentLock(paths.sessionsDir, context.state.agentId, async () =>
          updateConversationState(paths.sessionsDir, context, patch),
        ),
      );
    },
    async writeSystemPromptSnapshot(context, snapshot) {
      await withAgentWriteQueue(context.state.agentId, async () =>
        withAgentLock(paths.sessionsDir, context.state.agentId, async () =>
          writeSystemPromptSnapshot(paths.sessionsDir, context, snapshot),
        ),
      );
    },
    async listSystemPromptSnapshots(context) {
      return readSystemPromptSnapshots(paths.sessionsDir, context);
    },
    async markInterruptedRuns(now) {
      return markInterruptedAgentRuns(paths.sessionsDir, now);
    },
    async listInterruptedRuns() {
      return readInterruptedRuns(paths.sessionsDir);
    },
    async listBackups(ref) {
      const selectedAgentId = await readSelectedAgentId(paths.bindingsDir, ref);
      return selectedAgentId ? readAgentInactiveSessions(paths.sessionsDir, selectedAgentId) : [];
    },
    async restore(ref, backupId) {
      const selectedAgentId = await readSelectedAgentId(paths.bindingsDir, ref);
      return selectedAgentId
        ? restoreAgentSession(paths.sessionsDir, selectedAgentId, backupId)
        : false;
    },
    async create(ref, options) {
      await writeSelectedAgentId(paths.bindingsDir, ref, options.agentId);
      return createAgentSession(paths.sessionsDir, ref, options);
    },
    async ensureActive(ref, options) {
      const selectedAgentId = await readSelectedAgentId(paths.bindingsDir, ref) ?? options.agentId;
      await writeSelectedAgentId(paths.bindingsDir, ref, selectedAgentId);
      return ensureActiveAgentSession(paths.sessionsDir, ref, {
        ...options,
        agentId: selectedAgentId,
      });
    },
    async getSelectedAgent(ref) {
      return readSelectedAgentId(paths.bindingsDir, ref);
    },
    async setSelectedAgent(ref, agentId) {
      await writeSelectedAgentId(paths.bindingsDir, ref, agentId);
    },
    async getActiveForAgent(agentId) {
      return readActiveAgentConversation(paths.sessionsDir, agentId);
    },
    async listBackupsForAgent(agentId) {
      return readAgentInactiveSessions(paths.sessionsDir, agentId);
    },
    async restoreForAgent(agentId, backupId) {
      return restoreAgentSession(paths.sessionsDir, agentId, backupId);
    },
    async createForAgent(ref, options) {
      await writeSelectedAgentId(paths.bindingsDir, ref, options.agentId);
      return createAgentSession(paths.sessionsDir, ref, options);
    },
    async ensureActiveForAgent(ref, options) {
      await writeSelectedAgentId(paths.bindingsDir, ref, options.agentId);
      return ensureActiveAgentSession(paths.sessionsDir, ref, options);
    },
    async ensureDetachedForAgent(ref, options) {
      return ensureDetachedAgentSession(paths.sessionsDir, ref, options);
    },
  };
}

async function readInterruptedRuns(sessionsDir: string): Promise<ConversationContext[]> {
  let entries;

  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readInterruptedRunsForAgent(sessionsDir, entry.name)),
  );

  return sessions.flat();
}

async function readInterruptedRunsForAgent(
  sessionsDir: string,
  agentId: string,
): Promise<ConversationContext[]> {
  const entriesDir = getAgentEntriesDir(sessionsDir, agentId);
  let entries;

  try {
    entries = await readdir(entriesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const meta = await readSessionMetaByAgentAndSessionId(agentId, entry.name, sessionsDir);
        return meta?.run?.status === "interrupted"
          ? readSessionByAgentAndSessionId(agentId, entry.name, sessionsDir)
          : undefined;
      }),
  );

  return sessions.filter((conversation): conversation is ConversationContext => conversation !== undefined);
}

async function markInterruptedAgentRuns(
  sessionsDir: string,
  now: string,
): Promise<number> {
  let entries;

  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return 0;
    }
    throw error;
  }

  const counts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => markInterruptedRunsForAgent(sessionsDir, entry.name, now)),
  );

  return counts.reduce((total, count) => total + count, 0);
}

async function markInterruptedRunsForAgent(
  sessionsDir: string,
  agentId: string,
  now: string,
): Promise<number> {
  return withAgentWriteQueue(agentId, async () =>
    withAgentLock(sessionsDir, agentId, async () => {
      const entriesDir = getAgentEntriesDir(sessionsDir, agentId);
      let entries;

      try {
        entries = await readdir(entriesDir, { withFileTypes: true });
      } catch (error) {
        if (isMissingFileError(error)) {
          return 0;
        }
        throw error;
      }

      let interruptedCount = 0;
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const meta = await readSessionMetaByAgentAndSessionId(agentId, entry.name, sessionsDir);
        if (meta?.run?.status !== "running") {
          continue;
        }

        await writeSessionMeta(sessionsDir, {
          state: {
            ...toConversationState(meta),
            updatedAt: now,
            version: (meta.version ?? 0) + 1,
            run: {
              ...meta.run,
              status: "interrupted",
              updatedAt: now,
            },
          },
          messages: await readSessionEvents(sessionsDir, meta.conversation, agentId),
        });
        interruptedCount += 1;
      }

      return interruptedCount;
    }),
  );
}

async function readAgentInactiveSessions(
  sessionsDir: string,
  agentId: string,
  activeSessionId?: string,
): Promise<ConversationBackupSummary[]> {
  const activeRef = activeSessionId
    ? undefined
    : await readActiveAgentConversationRef(sessionsDir, agentId);
  const entriesDir = getAgentEntriesDir(sessionsDir, agentId);
  const resolvedActiveSessionId = activeSessionId ?? activeRef?.sessionId;
  let entries;

  try {
    entries = await readdir(entriesDir, { withFileTypes: true });
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

        const meta = await readSessionMetaByAgentAndSessionId(agentId, sessionId, sessionsDir);
        return meta ? toBackupSummary(meta) : undefined;
      }),
  );

  return backups
    .filter((backup): backup is ConversationBackupSummary => backup !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function createAgentSession(
  sessionsDir: string,
  ref: ChatRef,
  options: { agentId: string; now: string; title?: string },
): Promise<ConversationContext> {
  return withAgentWriteQueue(options.agentId, async () =>
    withAgentLock(sessionsDir, options.agentId, async () => {
      const context = createEmptyConversationContext(ref, options);

      await writeConversationLog(sessionsDir, context);
      await writeActiveAgentConversationRef(sessionsDir, context.state.agentId, context.state.conversation);
      return context;
    }),
  );
}

async function ensureActiveAgentSession(
  sessionsDir: string,
  ref: ChatRef,
  options: { agentId: string; now: string; title?: string },
): Promise<ConversationContext> {
  return withAgentWriteQueue(options.agentId, async () =>
    withAgentLock(sessionsDir, options.agentId, async () => {
      const activeRef = await readActiveAgentConversationRef(sessionsDir, options.agentId);
      if (activeRef) {
        const existing = await readSession(options.agentId, activeRef, sessionsDir);
        if (existing) {
          return existing;
        }
      }

      const created = createEmptyConversationContext(ref, options);
      await writeConversationLog(sessionsDir, created);
      await writeActiveAgentConversationRef(sessionsDir, options.agentId, created.state.conversation);
      return created;
    }),
  );
}

async function restoreAgentSession(
  sessionsDir: string,
  agentId: string,
  backupId: string,
): Promise<boolean> {
  return withAgentWriteQueue(agentId, async () =>
    withAgentLock(sessionsDir, agentId, async () => {
      const summaries = await readAgentInactiveSessions(sessionsDir, agentId);
      const selected = summaries.find((summary) => summary.id === backupId);
      if (!selected) {
        return false;
      }

      await writeActiveAgentConversationRef(sessionsDir, agentId, {
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
  options: {
    agentId: string;
    now: string;
    title?: string;
    sessionId?: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  },
): ConversationContext {
  const conversation: ConversationRef = {
    transport: ref.transport,
    externalId: ref.externalId,
    sessionId: options.sessionId ?? randomUUID(),
  };

  return {
    state: {
      conversation,
      agentId: options.agentId,
      ...(typeof options.kind === "string" ? { kind: options.kind } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      ...(typeof options.title === "string" ? { title: options.title } : {}),
      createdAt: options.now,
      updatedAt: options.now,
      version: 1,
    },
    messages: [],
  };
}

async function ensureDetachedAgentSession(
  sessionsDir: string,
  ref: ConversationRef,
  options: {
    agentId: string;
    now: string;
    title?: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ConversationContext> {
  const sessionId = requireSessionId(ref);
  return withAgentWriteQueue(options.agentId, async () =>
    withAgentLock(sessionsDir, options.agentId, async () => {
      const existing = await readSession(options.agentId, ref, sessionsDir);
      if (existing) {
        return existing;
      }

      const created = createEmptyConversationContext(ref, {
        ...options,
        sessionId,
      });
      await writeConversationLog(sessionsDir, created);
      return created;
    }),
  );
}

async function writeConversationLog(
  sessionsDir: string,
  context: ConversationContext,
): Promise<void> {
  const normalized = normalizeContext(context, {
    sessionsDir,
    conversation: context.state.conversation,
    agentId: context.state.agentId,
    materializeAttachmentPaths: true,
  });

  await writeSessionMeta(sessionsDir, normalized);
  await writeFileAtomically(
    getSessionEventsPath(sessionsDir, normalized.state.conversation, normalized.state.agentId),
    normalized.messages.map((message) => JSON.stringify(toStorageEvent(message, normalized, sessionsDir))).join("\n") +
      (normalized.messages.length > 0 ? "\n" : ""),
  );
}

async function appendConversationEvents(
  sessionsDir: string,
  context: ConversationContext,
  events: ConversationEvent[],
): Promise<ConversationContext> {
  if (events.length === 0) {
    return await readSession(context.state.agentId, context.state.conversation, sessionsDir) ?? context;
  }

  const current = await readSession(context.state.agentId, context.state.conversation, sessionsDir) ?? context;
  const existingById = new Map(current.messages.map((message) => [message.id, message]));
  const normalizedEvents = events.map((event) => normalizeConversationEvent(event, {
    sessionsDir,
    conversation: context.state.conversation,
    agentId: context.state.agentId,
    materializeAttachmentPaths: true,
  }));
  const newEvents: ConversationEvent[] = [];

  for (const event of normalizedEvents) {
    const existing = existingById.get(event.id);
    if (!existing) {
      existingById.set(event.id, event);
      newEvents.push(event);
      continue;
    }

    if (!areEventsEqual(existing, event)) {
      throw new Error(`Conversation write conflict: message "${event.id}" diverged`);
    }
  }

  if (newEvents.length === 0) {
    return current;
  }

  const next: ConversationContext = {
    state: {
      ...current.state,
      updatedAt: pickLatestTimestamp(current.state.updatedAt, newestEventTimestamp(newEvents)),
      version: (current.state.version ?? 0) + 1,
    },
    messages: [...current.messages, ...newEvents],
  };

  const eventsPath = getSessionEventsPath(sessionsDir, next.state.conversation, next.state.agentId);
  await mkdir(dirname(eventsPath), { recursive: true });
  await appendFile(
    eventsPath,
    newEvents.map((message) => JSON.stringify(toStorageEvent(message, next, sessionsDir))).join("\n") + "\n",
    "utf8",
  );
  await writeSessionMeta(sessionsDir, next);

  return next;
}

async function updateConversationState(
  sessionsDir: string,
  context: ConversationContext,
  patch: Partial<ConversationState>,
): Promise<ConversationContext> {
  const current = await readSession(context.state.agentId, context.state.conversation, sessionsDir) ?? context;
  const next: ConversationContext = {
    ...current,
    state: {
      ...current.state,
      ...patch,
      conversation: patch.conversation ?? current.state.conversation,
      agentId: patch.agentId ?? current.state.agentId,
      version: (current.state.version ?? 0) + 1,
    },
  };

  await writeSessionMeta(sessionsDir, next);
  return next;
}

interface StoredSystemPromptSnapshotMetadata extends Omit<ConversationSystemPromptSnapshot, "content"> {
  conversation?: ConversationRef;
  contentFile?: string;
}

async function readSystemPromptSnapshots(
  sessionsDir: string,
  context: ConversationContext,
): Promise<ConversationSystemPromptSnapshot[]> {
  const promptsDir = getSystemPromptsDir(sessionsDir, context.state.conversation, context.state.agentId);
  let entries;

  try {
    entries = await readdir(promptsDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  const snapshots: ConversationSystemPromptSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const metadataPath = join(promptsDir, entry.name);
    const metadata = await readJsonFile<StoredSystemPromptSnapshotMetadata>(metadataPath);
    if (!metadata?.contentFile) {
      continue;
    }

    let content;
    try {
      content = await readFile(join(promptsDir, metadata.contentFile), "utf8");
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }

    snapshots.push({
      messageId: metadata.messageId,
      correlationId: metadata.correlationId,
      agentId: metadata.agentId,
      createdAt: metadata.createdAt,
      cacheHit: metadata.cacheHit,
      sources: metadata.sources,
      ...(metadata.promptWorkingDirectory ? { promptWorkingDirectory: metadata.promptWorkingDirectory } : {}),
      content,
    });
  }

  return snapshots.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function writeSystemPromptSnapshot(
  sessionsDir: string,
  context: ConversationContext,
  snapshot: ConversationSystemPromptSnapshot,
): Promise<void> {
  const promptId = sanitizePathSegment(snapshot.messageId);
  const promptsDir = getSystemPromptsDir(sessionsDir, context.state.conversation, context.state.agentId);
  const promptFileName = `${promptId}.md`;
  const metadataFileName = `${promptId}.json`;

  await writeFileAtomically(join(promptsDir, promptFileName), snapshot.content);
  await writeFileAtomically(
    join(promptsDir, metadataFileName),
    `${JSON.stringify({
      messageId: snapshot.messageId,
      correlationId: snapshot.correlationId,
      agentId: snapshot.agentId,
      conversation: context.state.conversation,
      createdAt: snapshot.createdAt,
      cacheHit: snapshot.cacheHit,
      sources: snapshot.sources,
      ...(snapshot.promptWorkingDirectory
        ? { promptWorkingDirectory: snapshot.promptWorkingDirectory }
        : {}),
      contentFile: promptFileName,
    }, null, 2)}\n`,
  );
}

async function writeSessionMeta(
  sessionsDir: string,
  context: ConversationContext,
): Promise<void> {
  const meta: StoredConversationMeta = {
    ...context.state,
    version: context.state.version ?? 1,
    messageCount: context.messages.length,
  };

  await writeFileAtomically(
    getSessionMetaPath(sessionsDir, context.state.conversation, context.state.agentId),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
}

function toBackupSummary(meta: StoredConversationMeta): ConversationBackupSummary {
  const sessionId = requireSessionId(meta.conversation);
  return {
    id: sessionId,
    sessionId,
    transport: meta.conversation.transport,
    externalId: meta.conversation.externalId,
    ...(meta.title ? { title: meta.title } : {}),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    agentId: meta.agentId,
    messageCount: meta.messageCount ?? 0,
    ...(meta.workingDirectory
      ? { workingDirectory: meta.workingDirectory }
      : {}),
  };
}

async function readSession(
  agentId: string,
  ref: ConversationRef,
  sessionsDir: string,
): Promise<ConversationContext | undefined> {
  const meta = await readSessionMeta(agentId, ref, sessionsDir);
  if (!meta) {
    return undefined;
  }

  const messages = await readSessionEvents(sessionsDir, meta.conversation, agentId);
  return normalizeContext({
    state: toConversationState(meta),
    messages,
  }, {
    sessionsDir,
    conversation: meta.conversation,
    agentId,
    materializeAttachmentPaths: true,
  });
}

async function readSessionMeta(
  agentId: string,
  ref: ConversationRef,
  sessionsDir: string,
): Promise<StoredConversationMeta | undefined> {
  const metaPath = getSessionMetaPath(sessionsDir, ref, agentId);
  const parsed = await readJsonFile<StoredConversationMeta>(metaPath);
  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    conversation: parsed.conversation ?? ref,
    agentId: parsed.agentId ?? agentId,
    version: parsed.version ?? 1,
  };
}

async function readSessionMetaByAgentAndSessionId(
  agentId: string,
  sessionId: string,
  sessionsDir: string,
): Promise<StoredConversationMeta | undefined> {
  return readSessionMeta(agentId, {
    transport: "_",
    externalId: "_",
    sessionId,
  }, sessionsDir);
}

async function readSessionByAgentAndSessionId(
  agentId: string,
  sessionId: string,
  sessionsDir: string,
): Promise<ConversationContext | undefined> {
  return readSession(agentId, {
    transport: "_",
    externalId: "_",
    sessionId,
  }, sessionsDir);
}

async function readSessionBySessionId(
  ref: ConversationRef,
  sessionsDir: string,
): Promise<ConversationContext | undefined> {
  const sessionId = requireSessionId(ref);
  let entries;

  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
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

    const snapshot = await readSessionByAgentAndSessionId(entry.name, sessionId, sessionsDir);
    if (snapshot) {
      return snapshot;
    }
  }

  return undefined;
}

async function readSessionEvents(
  sessionsDir: string,
  ref: ConversationRef,
  agentId: string,
): Promise<ConversationEvent[]> {
  try {
    const raw = await readFile(getSessionEventsPath(sessionsDir, ref, agentId), "utf8");
    const lines = raw.split(/\r?\n/);
    const events: ConversationEvent[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      try {
        events.push(JSON.parse(line) as ConversationEvent);
      } catch (error) {
        if (index === lines.length - 1) {
          continue;
        }
        throw error;
      }
    }

    return events;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

function toConversationState(meta: StoredConversationMeta): ConversationState {
  return {
    conversation: meta.conversation,
    agentId: meta.agentId,
    ...(meta.kind ? { kind: meta.kind } : {}),
    ...(meta.metadata ? { metadata: meta.metadata } : {}),
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.workingDirectory ? { workingDirectory: meta.workingDirectory } : {}),
    ...(meta.compaction ? { compaction: meta.compaction } : {}),
    ...(meta.run ? { run: meta.run } : {}),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    version: meta.version,
  };
}

async function readSelectedAgentId(
  bindingsDir: string,
  ref: ChatRef,
): Promise<string | undefined> {
  const selectedAgentPath = getSelectedAgentPath(bindingsDir, ref);
  const parsed = await readJsonFile<{ agentId?: unknown }>(selectedAgentPath);
  if (!parsed || typeof parsed.agentId !== "string" || parsed.agentId.length === 0) {
    return undefined;
  }

  return parsed.agentId;
}

async function writeSelectedAgentId(
  bindingsDir: string,
  ref: ChatRef,
  agentId: string,
): Promise<void> {
  const selectedAgentPath = getSelectedAgentPath(bindingsDir, ref);
  await writeFileAtomically(selectedAgentPath, `${JSON.stringify({ agentId }, null, 2)}\n`);
}

async function readActiveAgentConversation(
  sessionsDir: string,
  agentId: string,
): Promise<ConversationContext | undefined> {
  const activeRef = await readActiveAgentConversationRef(sessionsDir, agentId);
  return activeRef ? readSession(agentId, activeRef, sessionsDir) : undefined;
}

async function readActiveAgentConversationRef(
  sessionsDir: string,
  agentId: string,
): Promise<ConversationRef | undefined> {
  const activePath = getAgentActiveSessionPath(sessionsDir, agentId);
  const parsed = await readJsonFile<{
    transport?: unknown;
    externalId?: unknown;
    sessionId?: unknown;
  }>(activePath);
  if (
    !parsed ||
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
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    const quarantinePath = `${path}.corrupt-${Date.now()}`;
    console.warn(`Ignoring corrupt JSON file at ${path}; moved to ${quarantinePath}`);

    try {
      await rename(path, quarantinePath);
    } catch (renameError: unknown) {
      if (!isMissingFileError(renameError)) {
        throw renameError;
      }
    }

    return undefined;
  }
}

async function writeActiveAgentConversationRef(
  sessionsDir: string,
  agentId: string,
  ref: ConversationRef,
): Promise<void> {
  const activePath = getAgentActiveSessionPath(sessionsDir, agentId);
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
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, content, { encoding: "utf8" });
}

function normalizeContext(
  context: ConversationContext,
  options: {
    sessionsDir: string;
    conversation: ConversationRef;
    agentId: string;
    materializeAttachmentPaths: boolean;
  },
): ConversationContext {
  return {
    ...context,
    state: {
      ...context.state,
      version: context.state.version ?? 1,
    },
    messages: context.messages.map((message) => normalizeConversationEvent(message, options)),
  };
}

function normalizeConversationEvent(
  message: unknown,
  options: {
    sessionsDir: string;
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
    sessionsDir: string;
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
    sessionsDir: string;
    conversation: ConversationRef;
    agentId: string;
    materializeAttachmentPaths: boolean;
  },
): ConversationUserMessage["source"] {
  if (message.source?.kind === "telegram-document" && message.source.document) {
    const document = message.source.document;
    const relativePath = normalizeAttachmentRelativePath(
      document.relativePath ?? inferAttachmentRelativePath(message, options.conversation),
    );
    const savedPath =
      options.materializeAttachmentPaths && relativePath
        ? materializeAttachmentPath(options.sessionsDir, options.conversation, options.agentId, relativePath)
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

  if (message.source?.kind !== "telegram-image" || !message.source.image) {
    return message.source;
  }

  const image = message.source.image;
  const relativePath = normalizeAttachmentRelativePath(
    image.relativePath ?? inferAttachmentRelativePath(message, options.conversation),
  );
  const savedPath =
    options.materializeAttachmentPaths && relativePath
      ? materializeAttachmentPath(options.sessionsDir, options.conversation, options.agentId, relativePath)
      : image.savedPath;

  return {
    ...message.source,
    image: {
      ...image,
      ...(relativePath ? { relativePath } : {}),
      ...(savedPath ? { savedPath } : {}),
    },
  };
}

function toStorageEvent(
  message: ConversationEvent,
  context: ConversationContext,
  sessionsDir: string,
): ConversationEvent {
  if (message.role !== "user" || !message.source) {
    return message;
  }

  if (message.source.kind === "telegram-document" && message.source.document) {
    const relativePath = normalizeAttachmentRelativePath(
      message.source.document.relativePath ??
        getAttachmentRelativePathFromSavedPath(
          sessionsDir,
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
  }

  if (message.source.kind !== "telegram-image" || !message.source.image) {
    return message;
  }

  const relativePath = normalizeAttachmentRelativePath(
    message.source.image.relativePath ??
      getAttachmentRelativePathFromSavedPath(
        sessionsDir,
        context.state.conversation,
        context.state.agentId,
        message,
      ),
  );
  const image = {
    ...message.source.image,
    ...(relativePath ? { relativePath } : {}),
  };
  delete image.savedPath;

  return {
    ...message,
    source: {
      ...message.source,
      image,
    },
  };
}

function getAttachmentRelativePathFromSavedPath(
  sessionsDir: string,
  conversation: ConversationRef,
  agentId: string,
  message: ConversationUserMessage,
): string | undefined {
  const savedPath = getSourceAttachmentSavedPath(message);
  if (!savedPath || !isAbsolute(savedPath)) {
    return savedPath;
  }

  const sessionDir = getSessionDir(sessionsDir, conversation, agentId);
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
  const savedPath = getSourceAttachmentSavedPath(message);
  if (!savedPath) {
    return undefined;
  }

  const normalized = savedPath.replaceAll("\\", "/");
  const marker = `/entries/${conversation.sessionId}/`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }

  return undefined;
}

function getSourceAttachmentSavedPath(message: ConversationUserMessage): string | undefined {
  if (message.source?.kind === "telegram-document") {
    return message.source.document?.savedPath;
  }

  if (message.source?.kind === "telegram-image") {
    return message.source.image?.savedPath;
  }

  return undefined;
}

function materializeAttachmentPath(
  sessionsDir: string,
  conversation: ConversationRef,
  agentId: string,
  relativePath: string,
): string {
  return join(
    getSessionDir(sessionsDir, conversation, agentId),
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

function areEventsEqual(left: ConversationEvent, right: ConversationEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function newestEventTimestamp(events: ConversationEvent[]): string {
  return events.reduce((latest, event) => pickLatestTimestamp(latest, event.createdAt), events[0]!.createdAt);
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
  return conversationWriteQueues.run(queueKey, action);
}

async function withAgentLock<T>(
  sessionsDir: string,
  agentId: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = getAgentLockPath(sessionsDir, agentId);
  await mkdir(dirname(lockPath), { recursive: true });
  const release = await acquireConversationLock(lockPath);

  try {
    return await action();
  } finally {
    await release();
  }
}

async function acquireConversationLock(lockPath: string): Promise<() => Promise<void>> {
  let compromisedError: Error | undefined;
  try {
    const release = await lockFile(lockPath, {
      realpath: false,
      stale: lockTtlMs,
      update: Math.floor(lockTtlMs / 2),
      retries: {
        retries: lockRetryCount,
        minTimeout: lockRetryDelayMs,
        maxTimeout: lockRetryDelayMs,
      },
      onCompromised(error) {
        compromisedError = error;
      },
    });

    return async () => {
      await release();
      if (compromisedError) {
        throw compromisedError;
      }
    };
  } catch (error) {
    if (isLockAcquisitionFailure(error)) {
      throw new Error(`Conversation write lock timed out: ${lockPath}`);
    }

    throw error;
  }
}

function isLockAcquisitionFailure(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ELOCKED";
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
