import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("returns undefined and quarantines corrupt selected-agent metadata", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const selectedAgentPath = join(
      root,
      "conversations",
      "chats",
      "telegram",
      "42",
      "selected-agent.json",
    );
    await mkdir(dirname(selectedAgentPath), { recursive: true });
    await writeFile(selectedAgentPath, "{not-json", "utf8");

    await expect(store.get(createChatRef())).resolves.toBeUndefined();

    const entries = await readdir(dirname(selectedAgentPath));
    expect(entries).not.toContain("selected-agent.json");
    expect(entries.some((entry) => entry.startsWith("selected-agent.json.corrupt-"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("returns undefined and quarantines corrupt active conversation pointer", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const selectedAgentPath = join(
      root,
      "conversations",
      "chats",
      "telegram",
      "42",
      "selected-agent.json",
    );
    const activePath = join(root, "conversations", "agents", "default", "active.json");
    await mkdir(dirname(selectedAgentPath), { recursive: true });
    await mkdir(dirname(activePath), { recursive: true });
    await writeFile(selectedAgentPath, `${JSON.stringify({ agentId: "default" })}\n`, "utf8");
    await writeFile(activePath, "{this-is: broken", "utf8");

    await expect(store.get(createChatRef())).resolves.toBeUndefined();

    const entries = await readdir(dirname(activePath));
    expect(entries).not.toContain("active.json");
    expect(entries.some((entry) => entry.startsWith("active.json.corrupt-"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("returns undefined and quarantines corrupt session meta without crashing", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const selectedAgentPath = join(
      root,
      "conversations",
      "chats",
      "telegram",
      "42",
      "selected-agent.json",
    );
    const activePath = join(root, "conversations", "agents", "default", "active.json");
    const sessionDir = join(root, "conversations", "agents", "default", "sessions", "session-1");
    const metaPath = join(sessionDir, "meta.json");
    await mkdir(dirname(selectedAgentPath), { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(selectedAgentPath, `${JSON.stringify({ agentId: "default" })}\n`, "utf8");
    await writeFile(activePath, `${JSON.stringify({ transport: "telegram", externalId: "42", sessionId: "session-1" })}\n`, "utf8");
    await writeFile(metaPath, "{ bad", "utf8");

    await expect(store.get(createChatRef())).resolves.toBeUndefined();

    const entries = await readdir(sessionDir);
    expect(entries).not.toContain("meta.json");
    expect(entries.some((entry) => entry.startsWith("meta.json.corrupt-"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("keeps throwing non-ENOENT I/O errors for selected-agent reads", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const selectedAgentPath = join(
      root,
      "conversations",
      "chats",
      "telegram",
      "42",
      "selected-agent.json",
    );
    await mkdir(selectedAgentPath, { recursive: true });

    await expect(store.get(createChatRef())).rejects.toMatchObject({ code: "EISDIR" });
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

  it("writes system prompt snapshots as session artifacts", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const created = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });

    await store.writeSystemPromptSnapshot!(created, {
      messageId: "msg/1",
      correlationId: "corr-1",
      agentId: "default",
      createdAt: "2026-04-05T00:00:01.000Z",
      content: "Base prompt\n\n<INSTRUCTIONS from=\"AGENTS.md\">\n\nUse facts.\n</INSTRUCTIONS>",
      cacheHit: false,
      sources: {
        basePromptSource: "file",
        basePromptFile: "/workspace/SYSTEM.md",
        instructionFiles: ["/workspace/AGENTS.md"],
        configuredInstructionFiles: [],
        agentHomeInstructionFiles: [],
        workspaceInstructionFile: "/workspace/AGENTS.md",
        referenceFiles: ["/workspace/RUNBOOK.md"],
        configuredReferenceFiles: ["/workspace/RUNBOOK.md"],
      },
      promptWorkingDirectory: "/workspace",
    });

    const promptDir = join(
      root,
      "conversations",
      "agents",
      "default",
      "sessions",
      created.state.conversation.sessionId!,
      "system-prompts",
    );
    await expect(readFile(join(promptDir, "msg_1.md"), "utf8")).resolves.toBe(
      "Base prompt\n\n<INSTRUCTIONS from=\"AGENTS.md\">\n\nUse facts.\n</INSTRUCTIONS>",
    );
    await expect(readFile(join(promptDir, "msg_1.json"), "utf8")).resolves.toContain(
      "\"contentFile\": \"msg_1.md\"",
    );
    const metadata = JSON.parse(await readFile(join(promptDir, "msg_1.json"), "utf8")) as {
      messageId: string;
      conversation: { sessionId: string };
      sources: { workspaceInstructionFile?: string };
      promptWorkingDirectory?: string;
      content?: string;
    };
    expect(metadata).toMatchObject({
      messageId: "msg/1",
      conversation: {
        sessionId: created.state.conversation.sessionId,
      },
      sources: {
        workspaceInstructionFile: "/workspace/AGENTS.md",
      },
      promptWorkingDirectory: "/workspace",
    });
    expect(metadata.content).toBeUndefined();

    await store.writeSystemPromptSnapshot!(created, {
      messageId: "msg-2",
      correlationId: "corr-2",
      agentId: "default",
      createdAt: "2026-04-05T00:00:02.000Z",
      content: "Updated prompt",
      cacheHit: false,
      sources: {
        basePromptSource: "text",
        instructionFiles: [],
        configuredInstructionFiles: [],
        agentHomeInstructionFiles: [],
        referenceFiles: [],
        configuredReferenceFiles: [],
      },
    });

    await expect(store.listSystemPromptSnapshots!(created)).resolves.toMatchObject([
      {
        messageId: "msg/1",
        content: "Base prompt\n\n<INSTRUCTIONS from=\"AGENTS.md\">\n\nUse facts.\n</INSTRUCTIONS>",
      },
      {
        messageId: "msg-2",
        content: "Updated prompt",
      },
    ]);
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
      "agents",
      "default",
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
        "agents",
        "default",
        "sessions",
        created.state.conversation.sessionId!,
        "events.jsonl",
      ),
      "utf8",
    );
    expect(raw).toContain('"relativePath":"attachments/msg-1-report.txt"');
    expect(raw).not.toContain(savedPath);
  });

  it("persists and reloads telegram image attachment metadata", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const created = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const savedPath = join(
      root,
      "conversations",
      "agents",
      "default",
      "sessions",
      created.state.conversation.sessionId!,
      "attachments",
      "msg-1-image.png",
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
          content: "Describe this image",
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          createdAt: "2026-04-05T00:01:00.000Z",
          source: {
            kind: "telegram-image",
            image: {
              fileId: "img-file",
              fileUniqueId: "img-unique",
              fileName: "image.png",
              mimeType: "image/png",
              sizeBytes: 13,
              width: 640,
              height: 480,
              savedPath,
              telegramType: "photo",
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
            kind: "telegram-image",
            image: {
              fileId: "img-file",
              fileUniqueId: "img-unique",
              fileName: "image.png",
              mimeType: "image/png",
              sizeBytes: 13,
              width: 640,
              height: 480,
              relativePath: "attachments/msg-1-image.png",
              savedPath,
              telegramType: "photo",
            },
          },
        },
      ],
    });
    const raw = await readFile(
      join(
        root,
        "conversations",
        "agents",
        "default",
        "sessions",
        created.state.conversation.sessionId!,
        "events.jsonl",
      ),
      "utf8",
    );
    expect(raw).toContain('"relativePath":"attachments/msg-1-image.png"');
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
      "agents",
      "default",
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
      "agents",
      "default",
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
        "agents",
        "default",
        "sessions",
        created.state.conversation.sessionId!,
        "meta.json",
      ),
      "utf8",
    );

    expect(JSON.parse(written)).toEqual({
      ...created.state,
      messageCount: 0,
    });
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
      readFile(join(root, "conversations", "agents", "default", "sessions", "_", "meta.json"), "utf8"),
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
        transport: "telegram",
        externalId: "42",
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

  it("marks running sessions as interrupted on startup", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const created = await store.create(createChatRef(), {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });

    await store.updateState!(created, {
      updatedAt: "2026-04-05T00:01:00.000Z",
      run: {
        status: "running",
        messageId: "msg-1",
        correlationId: "corr-1",
        startedAt: "2026-04-05T00:01:00.000Z",
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
    });

    await expect(store.markInterruptedRuns!("2026-04-05T00:02:00.000Z")).resolves.toBe(1);
    await expect(store.get(created.state.conversation)).resolves.toMatchObject({
      state: {
        updatedAt: "2026-04-05T00:02:00.000Z",
        run: {
          status: "interrupted",
          messageId: "msg-1",
          correlationId: "corr-1",
          startedAt: "2026-04-05T00:01:00.000Z",
          updatedAt: "2026-04-05T00:02:00.000Z",
        },
      },
    });
    await expect(store.listInterruptedRuns!()).resolves.toMatchObject([
      {
        state: {
          conversation: created.state.conversation,
          agentId: "default",
          run: {
            status: "interrupted",
          },
        },
      },
    ]);
    await expect(store.markInterruptedRuns!("2026-04-05T00:03:00.000Z")).resolves.toBe(0);
  });

  it("shares one active session per agent across chats", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const telegramChat = createChatRef();
    const pluginChat = { transport: "file", externalId: "audio" };

    const telegramSession = await store.ensureActiveForAgent!(telegramChat, {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const pluginSession = await store.ensureActiveForAgent!(pluginChat, {
      agentId: "default",
      now: "2026-04-05T00:01:00.000Z",
    });

    expect(pluginSession.state.conversation.sessionId).toBe(telegramSession.state.conversation.sessionId);
    await expect(store.get(pluginChat)).resolves.toEqual(telegramSession);
  });

  it("creates detached agent sessions without replacing the active agent session", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const chat = createChatRef();

    const activeSession = await store.ensureActiveForAgent!(chat, {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const detachedRef = {
      transport: "file",
      externalId: "imp-phone-call-1",
      sessionId: "imp-phone-call-1",
      endpointId: "phone-ingress",
    };
    const detachedSession = await store.ensureDetachedForAgent!(detachedRef, {
      agentId: "default",
      now: "2026-04-05T00:01:00.000Z",
      kind: "phone-call",
      title: "Phone call: Thomas",
      metadata: {
        contact_id: "thomas",
      },
    });
    const secondRead = await store.ensureDetachedForAgent!(detachedRef, {
      agentId: "default",
      now: "2026-04-05T00:02:00.000Z",
      kind: "phone-call",
    });

    expect(detachedSession.state).toMatchObject({
      agentId: "default",
      kind: "phone-call",
      title: "Phone call: Thomas",
      metadata: {
        contact_id: "thomas",
      },
      conversation: {
        transport: "file",
        externalId: "imp-phone-call-1",
        sessionId: "imp-phone-call-1",
      },
    });
    expect(secondRead.state.conversation.sessionId).toBe(detachedSession.state.conversation.sessionId);
    await expect(store.getActiveForAgent!("default")).resolves.toEqual(activeSession);
    await expect(store.get(detachedRef)).resolves.toEqual(detachedSession);
  });

  it("tracks selected agents per chat without mutating existing sessions", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const chat = createChatRef();

    const defaultSession = await store.ensureActiveForAgent!(chat, {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const opsSession = await store.ensureActiveForAgent!(chat, {
      agentId: "ops",
      now: "2026-04-05T00:01:00.000Z",
    });

    expect(defaultSession.state.agentId).toBe("default");
    expect(opsSession.state.agentId).toBe("ops");
    expect(opsSession.state.conversation.sessionId).not.toBe(defaultSession.state.conversation.sessionId);
    await expect(store.get(chat)).resolves.toEqual(opsSession);
    await expect(store.getActiveForAgent!("default")).resolves.toEqual(defaultSession);
  });

  it("tracks selected agents per endpoint chat when endpoints share the same transport identity", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const jarvisChat = { transport: "cli", externalId: "local", endpointId: "imp.jarvis" };
    const grimoireChat = { transport: "cli", externalId: "local", endpointId: "imp.grimoire" };

    const jarvisSession = await store.ensureActiveForAgent!(jarvisChat, {
      agentId: "jarvis",
      now: "2026-04-05T00:00:00.000Z",
    });
    const grimoireSession = await store.ensureActiveForAgent!(grimoireChat, {
      agentId: "grimoire",
      now: "2026-04-05T00:01:00.000Z",
    });

    expect(jarvisSession.state.agentId).toBe("jarvis");
    expect(grimoireSession.state.agentId).toBe("grimoire");
    await expect(store.get(jarvisChat)).resolves.toEqual(jarvisSession);
    await expect(store.get(grimoireChat)).resolves.toEqual(grimoireSession);
  });

  it("keeps history agent-specific", async () => {
    const root = await createTempDir();
    const store = createFsConversationStore(createRuntimePaths(root));
    const chat = createChatRef();

    const defaultOld = await store.createForAgent!(chat, {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
      title: "Default old",
    });
    await store.createForAgent!(chat, {
      agentId: "default",
      now: "2026-04-05T00:01:00.000Z",
      title: "Default active",
    });
    await store.createForAgent!(chat, {
      agentId: "ops",
      now: "2026-04-05T00:02:00.000Z",
      title: "Ops active",
    });

    await expect(store.listBackupsForAgent!("default")).resolves.toMatchObject([
      {
        id: defaultOld.state.conversation.sessionId,
        title: "Default old",
        agentId: "default",
      },
    ]);
    await expect(store.listBackupsForAgent!("ops")).resolves.toEqual([]);
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
    conversationsDir: join(root, "conversations"),
    logsDir: join(root, "logs"),
    logFilePath: join(root, "logs", "daemon.log"),
    runtimeDir: join(root, "runtime"),
    runtimeStatePath: join(root, "runtime", "daemon.json"),
  };
}
