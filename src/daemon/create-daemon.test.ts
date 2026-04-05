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
    const botConfig = createBotConfig(root);
    const config = createConfig(botConfig);
    const conversationStore = createFsConversationStore(botConfig.paths);
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
      createConversationStore: () => conversationStore,
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
        correlationId: "corr-1",
      },
      {
        id: "1:assistant",
        role: "assistant",
        text: "reply:1",
        createdAt: expect.any(String),
        correlationId: "corr-1",
      },
    ]);

    const persistedConversation = JSON.parse(
      await readFile(
        join(botConfig.paths.conversationsDir, "telegram", "42", "conversation.json"),
        "utf8",
      ),
    ) as { messages: unknown[] };

    expect(persistedConversation.messages).toHaveLength(4);
  });

  it("builds the default agent from configured agents", async () => {
    const root = await createTempDir();
    const botConfig = createBotConfig(root);
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
        ...createConfig(botConfig),
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
    const botConfig = createBotConfig(root);
    const startTransport = vi.fn();

    const daemon = createDaemon(
      {
        ...createConfig(botConfig),
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

  it("starts all enabled bots with isolated runtime state", async () => {
    const root = await createTempDir();
    const privateBot = createBotConfig(root);
    const opsBot = createBotConfig(root, {
      id: "ops-telegram",
      defaultAgentId: "ops",
    });
    const startedBotIds: string[] = [];

    const daemon = createDaemon(
      {
        configPath: join(root, "config.json"),
        logging: {
          level: "info",
        },
        agents: [
          {
            id: "default",
            systemPrompt: "You are concise.",
            model: {
              provider: "test",
              modelId: "stub",
            },
          },
          {
            id: "ops",
            systemPrompt: "You are ops.",
            model: {
              provider: "test",
              modelId: "stub",
            },
          },
        ],
        activeBots: [privateBot, opsBot],
      },
      {
        engine: {
          run: vi.fn(async (input) => ({
            message: {
              conversation: input.message.conversation,
              text: input.agent.id,
            },
          })),
        },
        createTransport: (config) => ({
          async start(handler: TransportHandler) {
            startedBotIds.push(config.id);
            await handler.handle({
              ...createIncomingMessage("1", "hello"),
              botId: config.id,
            });
          },
        }),
      },
    );

    await daemon.start();

    expect(startedBotIds.sort()).toEqual(["ops-telegram", "private-telegram"]);
    await expect(readFile(privateBot.paths.logFilePath, "utf8")).resolves.toContain(
      '"message":"starting daemon with default agent \\"default\\""',
    );
    await expect(readFile(opsBot.paths.logFilePath, "utf8")).resolves.toContain(
      '"message":"starting daemon with default agent \\"ops\\""',
    );
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-daemon-test-"));
  tempDirs.push(path);
  return path;
}

function createRuntimePaths(root: string, botId = "private-telegram"): RuntimePaths {
  return {
    dataRoot: root,
    botRoot: join(root, "bots", botId),
    conversationsDir: join(root, "bots", botId, "conversations"),
    logsDir: join(root, "bots", botId, "logs"),
    logFilePath: join(root, "bots", botId, "logs", "daemon.log"),
    runtimeDir: join(root, "bots", botId, "runtime"),
    runtimeStatePath: join(root, "bots", botId, "runtime", "daemon.json"),
  };
}

function createBotConfig(
  root: string,
  overrides: Partial<DaemonConfig["activeBots"][number]> = {},
): DaemonConfig["activeBots"][number] {
  const id = overrides.id ?? "private-telegram";
  const paths = overrides.paths ?? createRuntimePaths(root, id);

  return {
    id,
    type: "telegram",
    token: "telegram-token",
    allowedUserIds: ["7"],
    defaultAgentId: "default",
    paths,
    ...overrides,
  };
}

function createConfig(botConfig: DaemonConfig["activeBots"][number]): DaemonConfig {
  return {
    configPath: join(botConfig.paths.dataRoot, "config.json"),
    logging: {
      level: "info",
    },
    activeBots: [botConfig],
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
    botId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId,
    correlationId: `corr-${messageId}`,
    userId: "7",
    text,
    receivedAt: "2026-04-05T00:00:00.000Z",
  };
}
