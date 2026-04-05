import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { IncomingMessage } from "../domain/message.js";
import type { AgentRunInput } from "../runtime/context.js";
import type { AgentEngine } from "../runtime/types.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import type { TransportHandler } from "../transports/types.js";
import { createDaemon } from "./create-daemon.js";
import type { DaemonConfig, RuntimePaths } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("createDaemon", () => {
  it("loads persisted transcript into the next agent run", async () => {
    const root = await createTempDir();
    const paths = createRuntimePaths(root);
    const config = createConfig(paths);
    const conversationStore = createFsConversationStore(paths);
    const runInputs: AgentRunInput[] = [];
    const engine: AgentEngine = {
      run: vi.fn(async (input) => {
        runInputs.push(input);
        return {
          message: {
            conversation: input.message.conversation,
            text: `reply:${runInputs.length}`,
          },
        };
      }),
    };

    const daemon = createDaemon(config, {
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      conversationStore,
      engine,
      createTransport: () => ({
        async start(handler: TransportHandler) {
          await handler.handle(createIncomingMessage("1", "hello"));
          await handler.handle(createIncomingMessage("2", "again"));
        },
      }),
    });

    await daemon.start();

    expect(runInputs).toHaveLength(2);
    expect(runInputs[0].conversation.messages).toEqual([]);
    expect(runInputs[1].conversation.messages).toEqual([
      {
        id: "1",
        role: "user",
        text: "hello",
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        id: "1:assistant",
        role: "assistant",
        text: "reply:1",
        createdAt: expect.any(String),
      },
    ]);

    const persistedMessages = JSON.parse(
      await readFile(
        join(paths.conversationsDir, "telegram", "42", "messages.json"),
        "utf8",
      ),
    ) as unknown[];

    expect(persistedMessages).toHaveLength(4);
  });

  it("builds the default agent from configured agents", async () => {
    const root = await createTempDir();
    const paths = createRuntimePaths(root);
    const runInputs: AgentRunInput[] = [];
    const engine: AgentEngine = {
      run: vi.fn(async (input) => {
        runInputs.push(input);
        return {
          message: {
            conversation: input.message.conversation,
            text: "configured",
          },
        };
      }),
    };

    const daemon = createDaemon(
      {
        ...createConfig(paths),
        agents: [
          {
            id: "default",
            systemPrompt: "You are configured from json.",
            model: {
              provider: "openai",
              modelId: "gpt-5.4",
            },
            tools: ["read"],
          },
        ],
      },
      {
        engine,
        createTransport: () => ({
          async start(handler: TransportHandler) {
            await handler.handle(createIncomingMessage("1", "hello"));
          },
        }),
      },
    );

    await daemon.start();

    expect(runInputs).toHaveLength(1);
    expect(runInputs[0]?.agent).toMatchObject({
      id: "default",
      systemPrompt: "You are configured from json.",
      model: {
        provider: "openai",
        modelId: "gpt-5.4",
      },
      tools: ["read"],
    });
  });

  it("fails startup when an agent references an unknown tool", async () => {
    const root = await createTempDir();
    const paths = createRuntimePaths(root);
    const startTransport = vi.fn();

    const daemon = createDaemon(
      {
        ...createConfig(paths),
        agents: [
          {
            id: "default",
            systemPrompt: "You are configured from json.",
            model: {
              provider: "openai",
              modelId: "gpt-5.4",
            },
            tools: ["bashh"],
          },
        ],
      },
      {
        engine: {
          run: vi.fn(),
        },
        createBuiltInToolRegistry: () => ({
          list: () => [],
          get: () => undefined,
          pick: () => [],
        }),
        createTransport: () => ({
          start: startTransport,
        }),
      },
    );

    await expect(daemon.start()).rejects.toThrow('Unknown tools for agent "default": bashh');
    expect(startTransport).not.toHaveBeenCalled();
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-daemon-test-"));
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

function createConfig(paths: RuntimePaths): DaemonConfig {
  return {
    paths,
    configPath: join(paths.dataRoot, "config.json"),
    defaultAgentId: "default",
    agents: [
      {
        id: "default",
        systemPrompt: "You are concise.",
        model: {
          provider: "test",
          modelId: "stub",
        },
      },
    ],
    activeBot: {
      id: "private-telegram",
      type: "telegram",
      token: "telegram-token",
      allowedUserIds: ["7"],
    },
  };
}

function createDefaultAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    systemPrompt: "You are concise.",
    model: {
      provider: "test",
      modelId: "stub",
    },
    tools: [],
    extensions: [],
  };
}

function createIncomingMessage(messageId: string, text: string): IncomingMessage {
  return {
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId,
    userId: "7",
    text,
    receivedAt: "2026-04-05T00:00:00.000Z",
  };
}
