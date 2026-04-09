import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { IncomingMessage } from "../domain/message.js";
import type { AgentRunInput } from "../runtime/context.js";
import type { AgentEngine } from "../runtime/types.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import type { Transport, TransportHandler } from "../transports/types.js";
import { createDaemon } from "./create-daemon.js";
import type { DaemonConfig, RuntimePaths } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
          await handler.handle(createTransportEvent(createIncomingMessage("1", "hello")));
          await handler.handle(createTransportEvent(createIncomingMessage("2", "again")));
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
        join(
          botConfig.paths.conversationsDir,
          "telegram",
          "42",
          "sessions",
          runInputs[1]!.conversation.state.conversation.sessionId!,
          "conversation.json",
        ),
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
            prompt: {
              base: {
                text: "You are configured from json.",
              },
            },
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
            await handler.handle(createTransportEvent(createIncomingMessage("1", "hello")));
          },
        }),
      },
    );

    await daemon.start();

    expect(runInputs).toHaveLength(1);
    expect(runInputs[0]?.agent).toMatchObject({
      id: "default",
      prompt: {
        base: {
          text: "You are configured from json.",
        },
      },
      model: {
        provider: "openai",
        modelId: "gpt-5.4",
      },
      tools: ["read"],
    });
  });

  it("accepts configured agents that define a file-backed base prompt", async () => {
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
            prompt: {
              base: {
                file: "/workspace/prompts/default.md",
              },
            },
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
            await handler.handle(createTransportEvent(createIncomingMessage("1", "hello")));
          },
        }),
      },
    );

    await daemon.start();

    expect(runInputs).toHaveLength(1);
    expect(runInputs[0]?.agent).toMatchObject({
      id: "default",
      prompt: {
        base: {
          file: "/workspace/prompts/default.md",
        },
      },
      model: {
        provider: "openai",
        modelId: "gpt-5.4",
      },
      tools: ["read"],
    });
    expect(runInputs[0]?.agent.prompt.base.text).toBeUndefined();
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
            prompt: {
              base: {
                text: "You are configured from json.",
              },
            },
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

  it("fails fast when an agent does not define a usable base prompt", async () => {
    const root = await createTempDir();
    const botConfig = createBotConfig(root);

    expect(() =>
      createDaemon(
        {
          ...createConfig(botConfig),
          agents: [
            {
              id: "default",
              prompt: {
                base: {},
              },
              model: {
                provider: "openai",
                modelId: "gpt-5.4",
              },
            },
          ],
        },
        {
          createTransport: () => ({
            start: vi.fn(),
          }),
        },
      ),
    ).toThrow('Configured agent "default" must define prompt.base.text or prompt.base.file.');
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
            prompt: {
              base: {
                text: "You are concise.",
              },
            },
            model: {
              provider: "test",
              modelId: "stub",
            },
          },
          {
            id: "ops",
            prompt: {
              base: {
                text: "You are ops.",
              },
            },
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
            await handler.handle(createTransportEvent({
              ...createIncomingMessage("1", "hello"),
              botId: config.id,
            }));
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

  it("exits cleanly on SIGTERM", async () => {
    const root = await createTempDir();
    const botConfig = createBotConfig(root);
    const config = createConfig(botConfig);
    const runtimeProcess = createFakeProcess();
    const transport = createBlockingTransport();

    const daemon = createDaemon(config, {
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      engine: {
        run: vi.fn(),
      },
      createTransport: () => transport,
      runtimeProcess,
    });

    const started = daemon.start();
    await transport.waitUntilStarted();
    runtimeProcess.emitSignal("SIGTERM");
    await started;

    await vi.waitFor(() => {
      expect(runtimeProcess.exit).toHaveBeenCalledWith(0);
    });
    expect(transport.stop).toHaveBeenCalledTimes(1);
    await expect(access(botConfig.paths.runtimeStatePath)).rejects.toThrow();
  });

  it("exits cleanly on SIGINT", async () => {
    const root = await createTempDir();
    const botConfig = createBotConfig(root);
    const runtimeProcess = createFakeProcess();
    const transport = createBlockingTransport();

    const daemon = createDaemon(createConfig(botConfig), {
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      engine: {
        run: vi.fn(),
      },
      createTransport: () => transport,
      runtimeProcess,
    });

    const started = daemon.start();
    await transport.waitUntilStarted();
    runtimeProcess.emitSignal("SIGINT");
    await started;

    await vi.waitFor(() => {
      expect(runtimeProcess.exit).toHaveBeenCalledWith(130);
    });
    expect(transport.stop).toHaveBeenCalledTimes(1);
    await expect(access(botConfig.paths.runtimeStatePath)).rejects.toThrow();
  });

  it("cleans up runtime state and stops transports when start fails", async () => {
    const root = await createTempDir();
    const botConfig = createBotConfig(root);
    const transport = createFailingTransport(new Error("boom"));

    const daemon = createDaemon(createConfig(botConfig), {
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      engine: {
        run: vi.fn(),
      },
      createTransport: () => transport,
    });

    await expect(daemon.start()).rejects.toThrow("boom");

    expect(transport.stop).toHaveBeenCalledTimes(1);
    await expect(access(botConfig.paths.runtimeStatePath)).rejects.toThrow();
  });

  it("closes bootstrapped engines when a later runtime fails during bootstrap", async () => {
    const root = await createTempDir();
    const privateBot = createBotConfig(root);
    const opsBot = createBotConfig(root, {
      id: "ops-telegram",
      defaultAgentId: "ops",
    });
    const close = vi.fn(async () => {});
    let storeCalls = 0;

    const daemon = createDaemon(
      {
        configPath: join(root, "config.json"),
        logging: {
          level: "info",
        },
        agents: [
          {
            id: "default",
            prompt: {
              base: {
                text: "You are concise.",
              },
            },
            model: {
              provider: "test",
              modelId: "stub",
            },
          },
          {
            id: "ops",
            prompt: {
              base: {
                text: "You are ops.",
              },
            },
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
          run: vi.fn(),
          close,
        },
        createConversationStore: () => {
          storeCalls += 1;
          if (storeCalls === 2) {
            throw new Error("store boom");
          }

          return createFsConversationStore(privateBot.paths);
        },
        createTransport: () => ({
          start: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
        }),
      },
    );

    await expect(daemon.start()).rejects.toThrow("store boom");

    expect(close).toHaveBeenCalledTimes(1);
    await expect(access(privateBot.paths.runtimeStatePath)).rejects.toThrow();
    await expect(access(opsBot.paths.runtimeStatePath)).rejects.toThrow();
  });

  it("stops all runtimes and removes all runtime state after a partial multi-bot start failure", async () => {
    const root = await createTempDir();
    const privateBot = createBotConfig(root);
    const opsBot = createBotConfig(root, {
      id: "ops-telegram",
      defaultAgentId: "ops",
    });
    const startedBotIds: string[] = [];
    const stoppingBotIds: string[] = [];

    const transports = new Map<string, Transport>([
      ["private-telegram", createBlockingTransport(startedBotIds, stoppingBotIds, "private-telegram")],
      ["ops-telegram", createFailingTransport(new Error("ops boom"), startedBotIds, stoppingBotIds, "ops-telegram")],
    ]);

    const daemon = createDaemon(
      {
        configPath: join(root, "config.json"),
        logging: {
          level: "info",
        },
        agents: [
          {
            id: "default",
            prompt: {
              base: {
                text: "You are concise.",
              },
            },
            model: {
              provider: "test",
              modelId: "stub",
            },
          },
          {
            id: "ops",
            prompt: {
              base: {
                text: "You are ops.",
              },
            },
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
          run: vi.fn(),
        },
        createTransport: (botConfig) => {
          const transport = transports.get(botConfig.id);
          if (!transport) {
            throw new Error(`missing transport for ${botConfig.id}`);
          }

          return transport;
        },
      },
    );

    await expect(daemon.start()).rejects.toThrow("ops boom");

    expect(startedBotIds).toContain("ops-telegram");
    expect(stoppingBotIds).toContain("ops-telegram");
    if (startedBotIds.includes("private-telegram")) {
      await vi.waitFor(() => {
        expect(stoppingBotIds).toContain("private-telegram");
      });
    }
    await expect(access(privateBot.paths.runtimeStatePath)).rejects.toThrow();
    await expect(access(opsBot.paths.runtimeStatePath)).rejects.toThrow();
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
    skillCatalog: [],
    skillIssues: [],
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
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
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
    prompt: {
      base: {
        text: "You are concise.",
      },
    },
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

function createTransportEvent(message: IncomingMessage) {
  return {
    message,
    deliver: vi.fn(async () => {}),
    runWithProcessing: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
  };
}

function createBlockingTransport(
  startedBotIds?: string[],
  stoppingBotIds?: string[],
  botId = "private-telegram",
): Transport & { waitUntilStarted(): Promise<void> } {
  let releaseStart: (() => void) | undefined;
  let resolveStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });

  return {
    async start() {
      startedBotIds?.push(botId);
      resolveStarted?.();
      await new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
    },
    stop: vi.fn(async () => {
      stoppingBotIds?.push(botId);
      releaseStart?.();
    }),
    waitUntilStarted: () => started,
  };
}

function createFailingTransport(
  error: Error,
  startedBotIds?: string[],
  stoppingBotIds?: string[],
  botId = "private-telegram",
): Transport {
  return {
    async start() {
      startedBotIds?.push(botId);
      throw error;
    },
    stop: vi.fn(async () => {
      stoppingBotIds?.push(botId);
    }),
  };
}

function createFakeProcess(): {
  emitSignal(signal: "SIGINT" | "SIGTERM"): void;
  exit: ReturnType<typeof vi.fn<(code?: number) => never>>;
  execPath: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd(): string;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): EventEmitter;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): EventEmitter;
} {
  const emitter = new EventEmitter();

  return {
    emitSignal(signal) {
      emitter.emit(signal);
    },
    exit: vi.fn((() => undefined as never) as (code?: number) => never),
    execPath: process.execPath,
    argv: [process.execPath, "/workspace/dist/main.js", "start"],
    env: process.env,
    cwd: () => "/workspace",
    off(event, listener) {
      emitter.off(event, listener);
      return emitter;
    },
    once(event, listener) {
      emitter.once(event, listener);
      return emitter;
    },
  };
}
