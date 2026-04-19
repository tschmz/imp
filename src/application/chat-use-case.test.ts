import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { DaemonConfig } from "../daemon/types.js";
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
});

function createDependencies(appConfig: AppConfig = createAppConfig()) {
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
      conversationStore: createConversationStore(),
      engine: {
        run: vi.fn(),
        close: vi.fn(async () => undefined),
      },
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

function createConversationStore(): ConversationStore {
  return {
    get: vi.fn(),
    put: vi.fn(),
    listBackups: vi.fn(),
    restore: vi.fn(),
    ensureActive: vi.fn(),
    create: vi.fn(),
  };
}

function createRuntimePaths(endpointId: string): DaemonConfig["activeEndpoints"][number]["paths"] {
  return {
    dataRoot: "/var/lib/imp",
    conversationsDir: `/var/lib/imp/endpoints/${endpointId}/conversations`,
    logsDir: "/var/lib/imp/logs/endpoints",
    logFilePath: `/var/lib/imp/logs/endpoints/${endpointId}.log`,
    runtimeDir: "/var/lib/imp/runtime/endpoints",
    runtimeStatePath: `/var/lib/imp/runtime/endpoints/${endpointId}.json`,
  };
}
