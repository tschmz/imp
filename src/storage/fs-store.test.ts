import { mkdtemp, readFile } from "node:fs/promises";
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

    await expect(store.get(context.state.conversation)).resolves.toEqual(context);
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
      },
      messages: [],
    };

    await store.put(context);

    const written = await readFile(
      join(root, "conversations", "telegram_web", "user_123", "meta.json"),
      "utf8",
    );

    expect(JSON.parse(written)).toEqual(context.state);
  });

  it("returns an empty transcript when only conversation state exists", async () => {
    const root = await createTempDir();
    const statePath = join(root, "conversations", "telegram", "42", "meta.json");
    await (await import("node:fs/promises")).mkdir(dirname(statePath), { recursive: true });
    await (await import("node:fs/promises")).writeFile(
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
      },
      messages: [],
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
