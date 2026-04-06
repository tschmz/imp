import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationContext } from "../domain/conversation.js";
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
  it("returns undefined for missing conversations", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));

    const result = await store.get({
      transport: "telegram",
      externalId: "42",
    });

    expect(result).toBeUndefined();
  });

  it("persists and reloads conversation state", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const context: ConversationContext = {
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 0,
      },
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "hello",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    };

    await store.put(context);

    await expect(store.get(context.state.conversation)).resolves.toEqual({
      ...context,
      state: {
        ...context.state,
        version: 1,
      },
    });
  });

  it("sanitizes path segments before writing to disk", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const context: ConversationContext = {
      state: {
        conversation: {
          transport: "telegram/web",
          externalId: "user/123",
        },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 0,
      },
      messages: [],
    };

    await store.put(context);

    const written = await readFile(
      join(root, "conversations", "telegram_web", "user_123", "conversation.json"),
      "utf8",
    );

    expect(JSON.parse(written)).toEqual({
      ...context,
      state: {
        ...context.state,
        version: 1,
      },
    });
  });

  it("loads legacy state file and returns an empty transcript when messages are missing", async () => {
    const root = await createTempDir();
    const statePath = join(root, "conversations", "telegram", "42", "meta.json");
    await (await import("node:fs/promises")).mkdir(dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
      }),
    );

    const store = createFsConversationStore(createRuntimePaths(root));

    await expect(store.get({ transport: "telegram", externalId: "42" })).resolves.toEqual({
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 0,
      },
      messages: [],
    });
  });

  it("detects conflicts when version does not match the latest snapshot", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const ref = { transport: "telegram", externalId: "42" };

    await store.put({
      state: {
        conversation: ref,
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 0,
      },
      messages: [],
    });

    await expect(
      store.put({
        state: {
          conversation: ref,
          agentId: "default",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:01:00.000Z",
          version: 0,
        },
        messages: [],
      }),
    ).rejects.toThrow("version mismatch");
  });

  it("accepts writes when updatedAt does not increase as long as version matches", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const ref = { transport: "telegram", externalId: "42" };

    await store.put({
      state: {
        conversation: ref,
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 0,
      },
      messages: [],
    });

    const latest = await store.get(ref);
    expect(latest).toBeDefined();

    await store.put({
      state: {
        ...latest!.state,
        updatedAt: "2026-04-05T00:00:00.000Z",
      },
      messages: [
        {
          id: "msg-2",
          role: "assistant",
          text: "still accepted",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    });

    await expect(store.get(ref)).resolves.toEqual({
      state: {
        ...latest!.state,
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 2,
      },
      messages: [
        {
          id: "msg-2",
          role: "assistant",
          text: "still accepted",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    });
  });

  it("serializes concurrent put calls for the same conversation without dropping messages", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const ref = { transport: "telegram", externalId: "42" };

    await store.put({
      state: {
        conversation: ref,
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 0,
      },
      messages: [],
    });

    const latest = await store.get(ref);
    expect(latest).toBeDefined();

    const firstWrite = store.put({
      state: {
        ...latest!.state,
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
      messages: [
        ...latest!.messages,
        {
          id: "msg-1",
          role: "user",
          text: "hello",
          createdAt: "2026-04-05T00:01:00.000Z",
        },
      ],
    });

    const secondWrite = store.put({
      state: {
        ...latest!.state,
        updatedAt: "2026-04-05T00:02:00.000Z",
      },
      messages: [
        ...latest!.messages,
        {
          id: "msg-2",
          role: "assistant",
          text: "world",
          createdAt: "2026-04-05T00:02:00.000Z",
        },
      ],
    });

    await Promise.all([firstWrite, secondWrite]);

    await expect(store.get(ref)).resolves.toEqual({
      state: {
        conversation: ref,
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:02:00.000Z",
        version: 3,
      },
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "hello",
          createdAt: "2026-04-05T00:01:00.000Z",
        },
        {
          id: "msg-2",
          role: "assistant",
          text: "world",
          createdAt: "2026-04-05T00:02:00.000Z",
        },
      ],
    });
  });

  it("backs up and clears the active conversation on reset", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const ref = { transport: "telegram", externalId: "42" };
    const snapshotPath = join(root, "conversations", "telegram", "42", "conversation.json");
    const backupPath = `${snapshotPath}.2026-04-05T00-03-04.000Z.bak`;

    await store.put({
      state: {
        conversation: ref,
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 0,
      },
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "hello",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    });

    await store.reset(ref, {
      now: new Date("2026-04-05T00:03:04.000Z"),
    });

    await expect(store.get(ref)).resolves.toBeUndefined();
    await expect(readFile(backupPath, "utf8")).resolves.toContain('"text": "hello"');
  });

  it("ignores orphan temp files from interrupted writes", async () => {
    const root = await createTempDir();
    const ref = { transport: "telegram", externalId: "42" };
    const snapshotPath = join(root, "conversations", "telegram", "42", "conversation.json");
    await (await import("node:fs/promises")).mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(
      `${snapshotPath}.tmp`,
      JSON.stringify({
        state: {
          conversation: ref,
          agentId: "default",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          version: 1,
        },
        messages: [
          {
            id: "stale",
            role: "user",
            text: "stale",
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
      }),
    );

    const store = createFsConversationStore(createRuntimePaths(root));
    await expect(store.get(ref)).resolves.toBeUndefined();
  });

  it("only exposes committed snapshots when a temp file coexists with a committed file", async () => {
    const root = await createTempDir();
    const ref = { transport: "telegram", externalId: "42" };
    const snapshotPath = join(root, "conversations", "telegram", "42", "conversation.json");
    await (await import("node:fs/promises")).mkdir(dirname(snapshotPath), { recursive: true });

    await writeFile(
      snapshotPath,
      JSON.stringify({
        state: {
          conversation: ref,
          agentId: "default",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:01:00.000Z",
          version: 2,
        },
        messages: [
          {
            id: "committed",
            role: "assistant",
            text: "committed",
            createdAt: "2026-04-05T00:01:00.000Z",
          },
        ],
      }),
    );
    await writeFile(
      `${snapshotPath}.tmp`,
      JSON.stringify({
        state: {
          conversation: ref,
          agentId: "default",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:02:00.000Z",
          version: 3,
        },
        messages: [
          {
            id: "uncommitted",
            role: "assistant",
            text: "uncommitted",
            createdAt: "2026-04-05T00:02:00.000Z",
          },
        ],
      }),
    );

    const store = createFsConversationStore(createRuntimePaths(root));
    await expect(store.get(ref)).resolves.toEqual({
      state: {
        conversation: ref,
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:01:00.000Z",
        version: 2,
      },
      messages: [
        {
          id: "committed",
          role: "assistant",
          text: "committed",
          createdAt: "2026-04-05T00:01:00.000Z",
        },
      ],
    });
  });
});

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
