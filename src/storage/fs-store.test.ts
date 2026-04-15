import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatRef, ConversationContext } from "../domain/conversation.js";
import type { RuntimePaths } from "../daemon/types.js";
import { createFsConversationStore } from "./fs-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("createFsConversationStore", () => {
  it("returns undefined for missing active conversations", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));

    await expect(store.get(createChatRef())).resolves.toBeUndefined();
  });

  it("creates and loads an active conversation with a generated session id", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));

    const created = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });

    expect(created.state.conversation.sessionId).toBeTruthy();
    await expect(store.get(createChatRef())).resolves.toEqual(created);
  });

  it("persists and reloads a specific session snapshot", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const created = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const next: ConversationContext = {
      state: {
        ...created.state,
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
      messages: [
        {
          kind: "message",
          id: "msg-1",
          role: "user",
          content: "hello",
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          createdAt: "2026-04-05T00:01:00.000Z",
        },
      ],
    };

    await store.put(next);

    await expect(store.get(created.state.conversation)).resolves.toEqual({
      ...next,
      state: {
        ...next.state,
        version: 2,
      },
    });
  });

  it("persists and reloads telegram document attachment metadata", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const created = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const savedPath = join(
      root,
      "conversations",
      "telegram",
      "42",
      "sessions",
      created.state.conversation.sessionId!,
      "attachments",
      "msg-1-report.txt",
    );
    const next: ConversationContext = {
      state: {
        ...created.state,
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
      messages: [
        {
          kind: "message",
          id: "msg-1",
          role: "user",
          content: "Please inspect this report",
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          createdAt: "2026-04-05T00:01:00.000Z",
          source: {
            kind: "telegram-document",
            document: {
              fileId: "doc-file",
              fileUniqueId: "doc-unique",
              fileName: "report.txt",
              mimeType: "text/plain",
              sizeBytes: 13,
              savedPath,
            },
          },
        },
      ],
    };

    await store.put(next);

    await expect(store.get(created.state.conversation)).resolves.toMatchObject({
      messages: [
        {
          source: {
            kind: "telegram-document",
            document: {
              fileId: "doc-file",
              fileUniqueId: "doc-unique",
              fileName: "report.txt",
              mimeType: "text/plain",
              sizeBytes: 13,
              relativePath: "attachments/msg-1-report.txt",
              savedPath,
            },
          },
        },
      ],
    });
    const raw = await readFile(
      join(
        root,
        "conversations",
        "telegram",
        "42",
        "sessions",
        created.state.conversation.sessionId!,
        "conversation.json",
      ),
      "utf8",
    );
    expect(raw).toContain('"relativePath": "attachments/msg-1-report.txt"');
    expect(raw).not.toContain(savedPath);
  });

  it("materializes telegram document saved paths after moving a conversation tree", async () => {
    const sourceRoot = await createTempDir();
    const sourceStore = createFsConversationStore(createRuntimePaths(sourceRoot));
    const created = await sourceStore.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const sourceSavedPath = join(
      sourceRoot,
      "conversations",
      "telegram",
      "42",
      "sessions",
      created.state.conversation.sessionId!,
      "attachments",
      "msg-1-report.txt",
    );
    await mkdir(dirname(sourceSavedPath), { recursive: true });
    await writeFile(sourceSavedPath, "file contents", "utf8");

    await sourceStore.put({
      state: {
        ...created.state,
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
      messages: [
        {
          kind: "message",
          id: "msg-1",
          role: "user",
          content: "Please inspect this report",
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          createdAt: "2026-04-05T00:01:00.000Z",
          source: {
            kind: "telegram-document",
            document: {
              fileId: "doc-file",
              fileName: "report.txt",
              relativePath: "attachments/msg-1-report.txt",
              savedPath: sourceSavedPath,
            },
          },
        },
      ],
    });

    const targetRoot = await createTempDir();
    await cp(join(sourceRoot, "conversations"), join(targetRoot, "conversations"), {
      recursive: true,
    });
    const targetStore = createFsConversationStore(createRuntimePaths(targetRoot));
    const targetConversation = await targetStore.get(created.state.conversation);
    const targetSavedPath = join(
      targetRoot,
      "conversations",
      "telegram",
      "42",
      "sessions",
      created.state.conversation.sessionId!,
      "attachments",
      "msg-1-report.txt",
    );

    expect(targetConversation?.messages[0]).toMatchObject({
      source: {
        kind: "telegram-document",
        document: {
          relativePath: "attachments/msg-1-report.txt",
          savedPath: targetSavedPath,
        },
      },
    });
    await expect(readFile(targetSavedPath, "utf8")).resolves.toBe("file contents");
  });

  it("persists and reloads native assistant tool history", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const created = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const next: ConversationContext = {
      state: {
        ...created.state,
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
      messages: [
        {
          kind: "message",
          id: "msg-1",
          role: "user",
          content: "hello",
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          createdAt: "2026-04-05T00:01:00.000Z",
        },
        {
          kind: "message",
          id: "msg-1:assistant:1",
          role: "assistant",
          createdAt: "2026-04-05T00:01:01.000Z",
          timestamp: Date.parse("2026-04-05T00:01:01.000Z"),
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Inspecting the config." },
            {
              type: "toolCall",
              id: "tool-1",
              name: "read_file",
              arguments: {
                path: "config.json",
              },
            },
          ],
        },
        {
          kind: "message",
          id: "msg-1:tool-result:1",
          role: "toolResult",
          createdAt: "2026-04-05T00:01:02.000Z",
          timestamp: Date.parse("2026-04-05T00:01:02.000Z"),
          toolCallId: "tool-1",
          toolName: "read_file",
          content: [{ type: "text", text: "{\"ok\":true}" }],
          details: {
            path: "config.json",
          },
          isError: false,
        },
        {
          kind: "message",
          id: "msg-1:assistant:2",
          role: "assistant",
          content: [{ type: "text", text: "The config looks valid." }],
          timestamp: Date.parse("2026-04-05T00:01:03.000Z"),
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          createdAt: "2026-04-05T00:01:03.000Z",
        },
      ],
    };

    await store.put(next);

    await expect(store.get(created.state.conversation)).resolves.toEqual({
      ...next,
      state: {
        ...next.state,
        version: 2,
      },
    });
  });

  it("sanitizes path segments before writing session snapshots to disk", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const created = await store.create(
      {
        transport: "telegram/web",
        externalId: "user/123",
      },
      {
        agentId: "default",
        now: "2026-04-05T00:00:00.000Z",
      },
    );

    const written = await readFile(
      join(
        root,
        "conversations",
        "telegram_web",
        "user_123",
        "sessions",
        created.state.conversation.sessionId!,
        "conversation.json",
      ),
      "utf8",
    );

    expect(JSON.parse(written)).toEqual(created);
  });

  it("sanitizes dot-only session path segments before writing snapshots", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const context: ConversationContext = {
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
          sessionId: "..",
        },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 1,
      },
      messages: [],
    };

    await store.put(context);

    await expect(
      readFile(join(root, "conversations", "telegram", "42", "sessions", "_", "conversation.json"), "utf8"),
    ).resolves.toContain('"sessionId": ".."');
  });

  it("lists inactive sessions as restore points after /new-style creation", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));

    const first = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    await store.put({
      state: {
        ...first.state,
        title: "Earlier session",
        updatedAt: "2026-04-05T00:02:00.000Z",
      },
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: [{ type: "text", text: "finished" }],
          timestamp: Date.parse("2026-04-05T00:02:00.000Z"),
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          createdAt: "2026-04-05T00:02:00.000Z",
        },
      ],
    });

    const second = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:03:00.000Z",
    });

    const backups = await store.listBackups(createChatRef());

    expect(backups).toEqual([
      {
        id: first.state.conversation.sessionId!,
        sessionId: first.state.conversation.sessionId!,
        title: "Earlier session",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:02:00.000Z",
        agentId: "default",
        messageCount: 1,
      },
    ]);
    await expect(store.get(createChatRef())).resolves.toEqual(second);
  });

  it("restores a previous session by switching the active pointer", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));

    const first = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    await store.put({
      state: {
        ...first.state,
        title: "Older",
        workingDirectory: "/workspace/app",
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
      messages: [
        {
          kind: "message",
          id: "msg-1",
          role: "assistant",
          content: [{ type: "text", text: "older" }],
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          createdAt: "2026-04-05T00:01:00.000Z",
        },
      ],
    });

    const current = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:04:00.000Z",
    });
    await store.put({
      state: {
        ...current.state,
        title: "Current",
        updatedAt: "2026-04-05T00:05:00.000Z",
      },
      messages: [
        {
          id: "msg-current",
          role: "assistant",
          content: [{ type: "text", text: "newer" }],
          timestamp: Date.parse("2026-04-05T00:05:00.000Z"),
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          createdAt: "2026-04-05T00:05:00.000Z",
        },
      ],
    });

    const restored = await store.restore(createChatRef(), first.state.conversation.sessionId!, {
      now: new Date("2026-04-05T00:06:04.000Z"),
    });

    expect(restored).toBe(true);
    await expect(store.get(createChatRef())).resolves.toEqual({
      state: {
        ...first.state,
        title: "Older",
        workingDirectory: "/workspace/app",
        updatedAt: "2026-04-05T00:01:00.000Z",
        version: 2,
      },
      messages: [
        {
          kind: "message",
          id: "msg-1",
          role: "assistant",
          content: [{ type: "text", text: "older" }],
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          createdAt: "2026-04-05T00:01:00.000Z",
        },
      ],
    });
    await expect(store.listBackups(createChatRef())).resolves.toMatchObject([
      {
        id: current.state.conversation.sessionId!,
        title: "Current",
        updatedAt: "2026-04-05T00:05:00.000Z",
        messageCount: 1,
      },
    ]);
  });

});

function createChatRef(): ChatRef {
  return {
    transport: "telegram",
    externalId: "42",
  };
}

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-store-test-"));
  tempDirs.push(path);
  return path;
}

function createRuntimePaths(root: string): RuntimePaths {
  return {
    dataRoot: root,
    endpointRoot: join(root, "endpoint"),
    conversationsDir: join(root, "conversations"),
    logsDir: join(root, "logs"),
    logFilePath: join(root, "logs", "daemon.log"),
    runtimeDir: join(root, "runtime"),
    runtimeStatePath: join(root, "runtime", "daemon.json"),
  };
}
