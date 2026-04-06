import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
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
          systemPrompt: "You are concise.",
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
});

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
      reset: vi.fn(async () => undefined),
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
      })),
    },
  };
}
