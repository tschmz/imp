import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { IncomingMessage } from "../domain/message.js";
import type { TransportHandler } from "../transports/types.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import { createRuntimeEntries } from "./runtime-runner.js";

describe("createRuntimeEntries", () => {
  it("uses the provided transport factory instead of an internal transport default", async () => {
    const runtime = createRuntime();
    const transport = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const createTransport = vi.fn(() => transport);
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport,
    });

    await entries[0]?.start();

    expect(createTransport).toHaveBeenCalledWith(runtime.botConfig, runtime.logger);
    expect(transport.start).toHaveBeenCalledOnce();
  });

  it("treats /new text as a priority command before session resolution", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        botId: "private-telegram",
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        messageId: "99",
        correlationId: "corr-99",
        userId: "7",
        text: "/new",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(runtime.conversationStore.ensureActive).not.toHaveBeenCalled();
    expect(runtime.conversationStore.create).toHaveBeenCalledWith(
      {
        transport: "telegram",
        externalId: "42",
      },
      expect.objectContaining({
        agentId: "default",
      }),
    );
    expect(runtime.engine.run).not.toHaveBeenCalled();
  });

  it("treats /status text as a priority command before session resolution", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        botId: "private-telegram",
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        messageId: "100",
        correlationId: "corr-100",
        userId: "7",
        text: "/status",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(runtime.conversationStore.ensureActive).not.toHaveBeenCalled();
    expect(runtime.conversationStore.get).toHaveBeenCalledWith({
      transport: "telegram",
      externalId: "42",
    });
    expect(runtime.conversationStore.listBackups).toHaveBeenCalledWith({
      transport: "telegram",
      externalId: "42",
    });
    expect(runtime.engine.run).not.toHaveBeenCalled();
  });

  it("treats /rename text as a priority command before session resolution", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        botId: "private-telegram",
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        messageId: "100",
        correlationId: "corr-100",
        userId: "7",
        text: "/rename renamed",
        command: "rename",
        commandArgs: "renamed",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(runtime.conversationStore.ensureActive).not.toHaveBeenCalled();
    expect(runtime.conversationStore.get).toHaveBeenCalledWith({
      transport: "telegram",
      externalId: "42",
    });
  });

  it("closes the runtime engine when the entry stops", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await entries[0]?.stop();
    await entries[0]?.stop();

    expect(transport.stop).toHaveBeenCalledTimes(1);
    expect(runtime.engine.close).toHaveBeenCalledTimes(1);
  });

  it("logs discovered agent skills at runtime start", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          skillCatalog: [
            {
              name: "commit",
              description: "Stage and commit changes.",
              directoryPath: "/skills/commit",
              filePath: "/skills/commit/SKILL.md",
              body: "\nUse focused commits.",
              content: "---\nname: commit\ndescription: Stage and commit changes.\n---\n\nUse focused commits.",
              references: [],
              scripts: [],
            },
          ],
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();

    expect(runtime.logger.info).toHaveBeenCalledWith(
      "discovered agent skills",
      expect.objectContaining({
        botId: "private-telegram",
        agentId: "default",
        skillCount: 1,
        skillNames: ["commit"],
      }),
    );
  });
});

function createCapturingTransport(): {
  handler: TransportHandler;
  start: (handler: TransportHandler) => Promise<void>;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  let capturedHandler: TransportHandler | undefined;

  return {
    get handler() {
      if (!capturedHandler) {
        throw new Error("transport handler was not registered");
      }

      return capturedHandler;
    },
    start: vi.fn(async (handler: TransportHandler) => {
      capturedHandler = handler;
    }),
    stop: vi.fn(async () => undefined),
  };
}

function createEvent(message: IncomingMessage) {
  return {
    message,
    deliver: vi.fn(async () => undefined),
    runWithProcessing: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
  };
}

function createRuntime(): BootstrappedRuntime {
  return {
    botConfig: {
      id: "private-telegram",
      type: "telegram",
      token: "123:abc",
      allowedUserIds: ["7"],
      defaultAgentId: "default",
      paths: {
        dataRoot: "/tmp",
        botRoot: "/tmp/bots/private-telegram",
        conversationsDir: "/tmp/bots/private-telegram/conversations",
        logsDir: "/tmp/bots/private-telegram/logs",
        logFilePath: "/tmp/bots/private-telegram/logs/daemon.log",
        runtimeDir: "/tmp/bots/private-telegram/runtime",
        runtimeStatePath: "/tmp/bots/private-telegram/runtime/daemon.json",
      },
    },
    configPath: "/tmp/config.json",
    loggingLevel: "info",
    logger: {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    },
    conversationStore: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
      create: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
    },
    engine: {
      run: vi.fn(async () => ({
        message: {
          conversation: {
            transport: "telegram",
            externalId: "42",
          },
          text: "reply",
        },
        conversationEvents: [],
      })),
      close: vi.fn(async () => undefined),
    },
  };
}
