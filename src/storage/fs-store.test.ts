import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
          id: "msg-1",
          role: "user",
          text: "hello",
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

  it("persists and reloads tool call and tool result events", async () => {
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
          text: "hello",
          createdAt: "2026-04-05T00:01:00.000Z",
        },
        {
          kind: "tool-call",
          id: "msg-1:tool-call:1",
          createdAt: "2026-04-05T00:01:01.000Z",
          text: "Inspecting the config.",
          toolCalls: [
            {
              id: "tool-1",
              name: "read_file",
              arguments: {
                path: "config.json",
              },
            },
          ],
        },
        {
          kind: "tool-result",
          id: "msg-1:tool-result:1",
          createdAt: "2026-04-05T00:01:02.000Z",
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
          id: "msg-1:assistant",
          role: "assistant",
          text: "The config looks valid.",
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
          text: "finished",
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
          id: "msg-1",
          role: "assistant",
          text: "older",
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
          text: "newer",
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
          id: "msg-1",
          role: "assistant",
          text: "older",
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

  it("migrates a legacy active conversation into the new session layout", async () => {
    const root = await createTempDir();
    const chatRef = createChatRef();
    const snapshotPath = join(root, "conversations", "telegram", "42", "conversation.json");
    await (await import("node:fs/promises")).mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(
      snapshotPath,
      JSON.stringify({
        state: {
          conversation: chatRef,
          agentId: "default",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:01:00.000Z",
          version: 1,
        },
        messages: [
          {
            id: "legacy-1",
            role: "assistant",
            text: "legacy",
            createdAt: "2026-04-05T00:01:00.000Z",
          },
        ],
      }),
    );

    const store = createFsConversationStore(createRuntimePaths(root));
    const current = await store.get(chatRef);

    expect(current?.state.conversation.sessionId).toBe("legacy");
    await expect(store.listBackups(chatRef)).resolves.toEqual([]);
  });

  it("loads session snapshots written before tool event support", async () => {
    const root = await createTempDir();
    const ref = {
      ...createChatRef(),
      sessionId: "session-1",
    };
    const snapshotPath = join(
      root,
      "conversations",
      "telegram",
      "42",
      "sessions",
      "session-1",
      "conversation.json",
    );
    await (await import("node:fs/promises")).mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(
      snapshotPath,
      JSON.stringify({
        state: {
          conversation: ref,
          agentId: "default",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:01:00.000Z",
          version: 1,
        },
        messages: [
          {
            id: "legacy-1",
            role: "user",
            text: "hello",
            createdAt: "2026-04-05T00:00:00.000Z",
          },
          {
            id: "legacy-1:assistant",
            role: "assistant",
            text: "hi there",
            createdAt: "2026-04-05T00:00:01.000Z",
          },
        ],
      }),
      "utf8",
    );

    const store = createFsConversationStore(createRuntimePaths(root));

    await expect(store.get(ref)).resolves.toEqual({
      state: {
        conversation: ref,
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:01:00.000Z",
        version: 1,
      },
      messages: [
        {
          id: "legacy-1",
          role: "user",
          text: "hello",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "legacy-1:assistant",
          role: "assistant",
          text: "hi there",
          createdAt: "2026-04-05T00:00:01.000Z",
        },
      ],
    });
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
    botRoot: join(root, "bot"),
    conversationsDir: join(root, "conversations"),
    logsDir: join(root, "logs"),
    logFilePath: join(root, "logs", "daemon.log"),
    runtimeDir: join(root, "runtime"),
    runtimeStatePath: join(root, "runtime", "daemon.json"),
  };
}
