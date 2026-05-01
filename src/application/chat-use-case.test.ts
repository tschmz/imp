import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { DaemonConfig } from "../daemon/types.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { createRuntimeEntries, RuntimeEntry } from "../daemon/runtime-runner.js";
import type { ConversationStore } from "../storage/types.js";
import { createChatUseCase } from "./chat-use-case.js";

describe("createChatUseCase", () => {
  it("starts only the selected cli endpoint without starting a daemon", async () => {
    const dependencies = createDependencies(createAppConfig({
      endpoints: [
        {
          id: "local-cli",
          type: "cli",
          enabled: false,
          routing: {
            defaultAgentId: "ops",
          },
        },
      ],
    }));
    const useCase = createChatUseCase(dependencies);

    await useCase({ configPath: "/custom/config.json", endpointId: "local-cli" });

    expect(dependencies.discoverConfigPath).toHaveBeenCalledWith({
      cliConfigPath: "/custom/config.json",
    });
    expect(dependencies.resolveRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoints: [
          expect.objectContaining({
            id: "local-cli",
            type: "cli",
            enabled: true,
            routing: undefined,
          }),
        ],
      }),
      "/etc/imp/config.json",
      {
        includeCliEndpoints: true,
      },
    );
    expect(dependencies.prepareRuntimeFilesystem).toHaveBeenCalledWith(createRuntimePaths("local-cli"));
    expect(dependencies.buildRuntimeComponents).toHaveBeenCalledWith(
      expect.objectContaining({
        activeEndpoints: [expect.objectContaining({ id: "local-cli", type: "cli" })],
      }),
      expect.objectContaining({ id: "local-cli", type: "cli" }),
      expect.objectContaining({ createLogger: expect.any(Function) }),
    );
    expect(dependencies.createRuntimeEntries).toHaveBeenCalledWith(
      [expect.objectContaining({ endpointConfig: expect.objectContaining({ id: "local-cli", type: "cli" }) })],
      expect.objectContaining({
        createTransport: expect.any(Function),
        requestControlAction: expect.any(Function),
      }),
    );
    expect(dependencies.buildRuntimeComponents).toHaveBeenCalledWith(
      expect.objectContaining({
        activeEndpoints: [expect.objectContaining({ defaultAgentId: "default" })],
      }),
      expect.objectContaining({ defaultAgentId: "default" }),
      expect.any(Object),
    );
    expect(dependencies.runRuntimeEntries).toHaveBeenCalledWith([dependencies.runtimeEntry]);
    expect(dependencies.stopRuntimeEntries).toHaveBeenCalledWith([dependencies.runtimeEntry]);
  });

  it("uses an implicit local cli endpoint when the config has no cli endpoints", async () => {
    const dependencies = createDependencies(createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            env: "IMP_TELEGRAM_TOKEN",
          },
          access: {
            allowedUserIds: [],
          },
        },
      ],
    }));
    const useCase = createChatUseCase(dependencies);

    await useCase({});

    expect(dependencies.resolveRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoints: [
          {
            id: "local-cli",
            type: "cli",
            enabled: true,
          },
        ],
      }),
      "/etc/imp/config.json",
      {
        includeCliEndpoints: true,
      },
    );
  });

  it("uses an implicit local cli endpoint when the config has no endpoints", async () => {
    const dependencies = createDependencies(createAppConfig({
      endpoints: [],
    }));
    const useCase = createChatUseCase(dependencies);

    await useCase({});

    expect(dependencies.resolveRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoints: [
          {
            id: "local-cli",
            type: "cli",
            enabled: true,
          },
        ],
      }),
      "/etc/imp/config.json",
      {
        includeCliEndpoints: true,
      },
    );
  });

  it("rejects ambiguous configured cli endpoint selection", async () => {
    const useCase = createChatUseCase(
      createDependencies(createAppConfig({
        endpoints: [
          {
            id: "dev-cli",
            type: "cli",
            enabled: false,
          },
          {
            id: "ops-cli",
            type: "cli",
            enabled: false,
          },
        ],
      })),
    );

    await expect(useCase({})).rejects.toThrow(
      "Multiple CLI endpoints are configured. Pass --endpoint with one of: dev-cli, ops-cli.",
    );
  });

  it("stops the direct chat runtime after reload or restart delivery actions", async () => {
    const dependencies = createDependencies();
    dependencies.runRuntimeEntries.mockImplementationOnce(async () => {
      const [, options] = dependencies.createRuntimeEntries.mock.calls[0]! as unknown as Parameters<
        typeof createRuntimeEntries
      >;
      await options.requestControlAction?.("restart");
    });
    const useCase = createChatUseCase(dependencies);

    await useCase({});

    expect(dependencies.stopRuntimeEntries).toHaveBeenCalledWith([dependencies.runtimeEntry]);
    expect(dependencies.stopRuntimeEntries).toHaveBeenCalledTimes(2);
  });

  it("loads the active session replay when starting direct chat", async () => {
    const conversationStore = createConversationStore({
      getSelectedAgent: vi.fn(async () => "ops"),
      getActiveForAgent: vi.fn(async () => createActiveConversation()),
    });
    const dependencies = createDependencies(createAppConfig(), conversationStore);
    const useCase = createChatUseCase(dependencies);

    await useCase({});

    expect(conversationStore.getSelectedAgent).toHaveBeenCalledWith({
      transport: "cli",
      externalId: "local",
      endpointId: "local-cli",
    });
    expect(conversationStore.getActiveForAgent).toHaveBeenCalledWith("ops");
    expect(dependencies.createRuntimeEntries).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          endpointConfig: expect.objectContaining({
            id: "local-cli",
            type: "cli",
            initialAgentId: "ops",
            initialReplay: [
              { role: "user", text: "old question", createdAt: "2026-04-05T00:00:10.000Z" },
              { role: "assistant", text: "old answer", createdAt: "2026-04-05T00:00:20.000Z" },
            ],
          }),
        }),
      ],
      expect.any(Object),
    );
  });
});

function createDependencies(
  appConfig: AppConfig = createAppConfig(),
  conversationStore: ConversationStore = createConversationStore(),
) {
  const runtimeEntry: RuntimeEntry = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };

  return {
    runtimeEntry,
    discoverConfigPath: vi.fn(async () => ({
      configPath: "/etc/imp/config.json",
      checkedPaths: ["/etc/imp/config.json"],
    })),
    loadAppConfig: vi.fn(async () => appConfig),
    resolveRuntimeConfig: vi.fn(async (resolvedAppConfig: AppConfig, configPath: string) => {
      const endpoint = resolvedAppConfig.endpoints[0]!;
      if (endpoint.type !== "cli") {
        throw new Error("Expected chat use case to resolve a CLI endpoint.");
      }

      return {
        configPath,
        logging: {
          level: "info",
          rotationSize: "5M",
        },
        agents: [],
        activeEndpoints: [
          {
            id: endpoint.id,
            type: "cli",
            userId: "local",
            defaultAgentId: endpoint.routing?.defaultAgentId ?? resolvedAppConfig.defaults.agentId,
            paths: createRuntimePaths(endpoint.id),
          },
        ],
      } satisfies DaemonConfig;
    }),
    prepareRuntimeFilesystem: vi.fn(async () => undefined),
    prepareAgentLogFiles: vi.fn(async () => undefined),
    buildRuntimeComponents: vi.fn(() => ({
      loggingLevel: "info" as const,
      logger: {
        debug: vi.fn(async () => undefined),
        info: vi.fn(async () => undefined),
        warn: vi.fn(async () => undefined),
        error: vi.fn(async () => undefined),
      },
      endpointLogger: {
        debug: vi.fn(async () => undefined),
        info: vi.fn(async () => undefined),
        error: vi.fn(async () => undefined),
      },
      agentLoggers: {
        forAgent: vi.fn(() => ({
          debug: vi.fn(async () => undefined),
          info: vi.fn(async () => undefined),
          error: vi.fn(async () => undefined),
        })),
      },
      conversationStore,
      engine: {
        run: vi.fn(),
        close: vi.fn(async () => undefined),
      },
      resolveAgentRuntimeSurface: vi.fn(async () => ({
        tools: [],
        skills: [],
      })),
      closeAgentRuntimeSurface: vi.fn(async () => undefined),
    })),
    createRuntimeEntries: vi.fn(() => [runtimeEntry]),
    runRuntimeEntries: vi.fn(async () => undefined),
    stopRuntimeEntries: vi.fn(async () => undefined),
  };
}

function createAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    instance: {
      name: "test",
    },
    paths: {
      dataRoot: "/var/lib/imp",
    },
    logging: {
      level: "info",
      rotationSize: "5M",
    },
    defaults: {
      agentId: "default",
    },
    agents: [
      {
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      },
    ],
    endpoints: overrides.endpoints ?? [
      {
        id: "local-cli",
        type: "cli",
        enabled: true,
      },
      {
        id: "private-telegram",
        type: "telegram",
        enabled: true,
        token: {
          env: "IMP_TELEGRAM_TOKEN",
        },
        access: {
          allowedUserIds: [],
        },
      },
    ],
    ...overrides,
  };
}

function createConversationStore(overrides: Partial<ConversationStore> = {}): ConversationStore {
  return {
    get: vi.fn(),
    put: vi.fn(),
    listBackups: vi.fn(),
    restore: vi.fn(),
    ensureActive: vi.fn(),
    create: vi.fn(),
    ...overrides,
  };
}

function createActiveConversation(): ConversationContext {
  return {
    state: {
      conversation: { transport: "cli", externalId: "local", sessionId: "session-1" },
      agentId: "ops",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:03:00.000Z",
      version: 1,
    },
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "old question",
        timestamp: Date.parse("2026-04-05T00:00:10.000Z"),
        createdAt: "2026-04-05T00:00:10.000Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden", thinkingSignature: "sig" },
          { type: "text", text: "old answer" },
          { type: "toolCall", id: "call-1", name: "shell", arguments: { cmd: "npm test" } },
        ],
        timestamp: Date.parse("2026-04-05T00:00:20.000Z"),
        createdAt: "2026-04-05T00:00:20.000Z",
        api: "test",
        provider: "test",
        model: "stub",
        stopReason: "stop",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
      {
        id: "msg-3",
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "shell",
        isError: false,
        content: [{ type: "text", text: "tool output" }],
        timestamp: Date.parse("2026-04-05T00:00:30.000Z"),
        createdAt: "2026-04-05T00:00:30.000Z",
      },
    ],
  };
}

function createRuntimePaths(endpointId: string): DaemonConfig["activeEndpoints"][number]["paths"] {
  return {
    dataRoot: "/var/lib/imp",
    sessionsDir: `/var/lib/imp/sessions`,
    bindingsDir: "/var/lib/imp/bindings",
    logsDir: "/var/lib/imp/logs",
    logFilePath: "/var/lib/imp/logs/endpoints.log",
    runtimeDir: "/var/lib/imp/runtime/endpoints",
    runtimeStatePath: `/var/lib/imp/runtime/endpoints/${endpointId}.json`,
  };
}
