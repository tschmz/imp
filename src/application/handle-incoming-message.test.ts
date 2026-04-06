import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { IncomingMessage } from "../domain/message.js";
import type { AgentEngine } from "../runtime/types.js";
import type { ConversationStore } from "../storage/types.js";
import { createHandleIncomingMessage } from "./handle-incoming-message.js";

describe("createHandleIncomingMessage", () => {
  it("loads or creates conversation, runs engine, persists transcript, and returns response", async () => {
    const agent = createDefaultAgent();
    const byConversation = new Map<string, Awaited<ReturnType<ConversationStore["get"]>>>();

    const conversationStore: ConversationStore = {
      get: vi.fn(async (ref) => byConversation.get(ref.externalId)),
      put: vi.fn(async (context) => {
        byConversation.set(context.state.conversation.externalId, context);
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      reset: vi.fn(async () => {}),
    };

    const engine: AgentEngine = {
      run: vi.fn(async ({ message }) => ({
        message: {
          conversation: message.conversation,
          text: "reply",
        },
      })),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const firstResponse = await service.handle(createIncomingMessage("1", "hello"));
    const secondResponse = await service.handle(createIncomingMessage("2", "again"));

    expect(firstResponse.text).toBe("reply");
    expect(secondResponse.text).toBe("reply");
    expect(engine.run).toHaveBeenCalledTimes(2);
    expect(conversationStore.reset).not.toHaveBeenCalled();

    const persisted = byConversation.get("42");
    expect(persisted?.messages).toHaveLength(4);
    expect(persisted?.messages[0]).toMatchObject({
      role: "user",
      text: "hello",
      correlationId: "corr-1",
    });
    expect(persisted?.messages[1]).toMatchObject({
      role: "assistant",
      text: "reply",
      correlationId: "corr-1",
    });
    expect(persisted?.messages[2]).toMatchObject({
      role: "user",
      text: "again",
      correlationId: "corr-2",
    });
    expect(persisted?.messages[3]).toMatchObject({
      role: "assistant",
      text: "reply",
      correlationId: "corr-2",
    });
  });

  it("persists the working directory returned by the engine for the next run", async () => {
    const agent = createDefaultAgent();
    const byConversation = new Map<string, Awaited<ReturnType<ConversationStore["get"]>>>();

    const conversationStore: ConversationStore = {
      get: vi.fn(async (ref) => byConversation.get(ref.externalId)),
      put: vi.fn(async (context) => {
        byConversation.set(context.state.conversation.externalId, context);
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      reset: vi.fn(async () => {}),
    };

    const engine: AgentEngine = {
      run: vi
        .fn<AgentEngine["run"]>()
        .mockResolvedValueOnce({
          message: {
            conversation: createIncomingMessage("1", "hello").conversation,
            text: "reply",
          },
          workingDirectory: "/workspace/next",
        })
        .mockImplementationOnce(async ({ conversation, message }) => {
          expect(conversation.state.workingDirectory).toBe("/workspace/next");
          return {
            message: {
              conversation: message.conversation,
              text: "reply",
            },
          };
        }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    await service.handle(createIncomingMessage("1", "hello"));
    await service.handle(createIncomingMessage("2", "again"));

    expect(byConversation.get("42")?.state.workingDirectory).toBe("/workspace/next");
  });

  it("resets the conversation for the new command without calling the engine", async () => {
    const agent = createDefaultAgent();
    const byConversation = new Map<string, Awaited<ReturnType<ConversationStore["get"]>>>();

    const conversationStore: ConversationStore = {
      get: vi.fn(async (ref) => byConversation.get(ref.externalId)),
      put: vi.fn(async (context) => {
        byConversation.set(context.state.conversation.externalId, context);
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      reset: vi.fn(async (ref) => {
        byConversation.delete(ref.externalId);
      }),
    };

    const engine: AgentEngine = {
      run: vi.fn(async () => {
        throw new Error("engine should not run for /new");
      }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const response = await service.handle(createIncomingMessage("3", "/new", "new"));

    expect(response).toEqual({
      conversation: {
        transport: "telegram",
        externalId: "42",
      },
      text: "Started a fresh conversation. The previous conversation was backed up.",
    });
    expect(conversationStore.reset).toHaveBeenCalledWith({
      transport: "telegram",
      externalId: "42",
    });
    expect(engine.run).not.toHaveBeenCalled();
    expect(byConversation.get("42")).toMatchObject({
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

  it("fails when the default agent cannot be resolved", () => {
    expect(() =>
      createHandleIncomingMessage({
        agentRegistry: createAgentRegistry([]),
        conversationStore: {
          get: vi.fn(),
          put: vi.fn(),
          listBackups: vi.fn(),
          restore: vi.fn(),
          reset: vi.fn(),
        },
        engine: {
          run: vi.fn(),
        },
        defaultAgentId: "missing",
        runtimeInfo: createRuntimeInfo(),
      }),
    ).toThrow("Unknown default agent: missing");
  });

  it("returns command help without loading conversation state", async () => {
    const conversationStore: ConversationStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      reset: vi.fn(async () => {}),
    };

    const engine: AgentEngine = {
      run: vi.fn(async () => {
        throw new Error("engine should not run for /help");
      }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const response = await service.handle(createIncomingMessage("4", "/help", "help"));

    expect(response.text).toContain("/help Show this help message.");
    expect(response.text).toContain("/restore <n>");
    expect(conversationStore.get).not.toHaveBeenCalled();
    expect(engine.run).not.toHaveBeenCalled();
  });

  it("reports the current conversation status and backup count", async () => {
    const conversationStore: ConversationStore = {
      get: vi.fn(async () => ({
        state: {
          conversation: {
            transport: "telegram",
            externalId: "42",
          },
          agentId: "default",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:05:00.000Z",
          workingDirectory: "/workspace/app",
          version: 2,
        },
        messages: [
          {
            id: "msg-1",
            role: "user" as const,
            text: "hello",
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
      })),
      put: vi.fn(async () => {}),
      listBackups: vi.fn(async () => [
        {
          id: "conversation.json.2026-04-05T00-03-04.000Z.bak",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:03:00.000Z",
          agentId: "default",
          messageCount: 2,
          workingDirectory: "/workspace/app",
        },
      ]),
      restore: vi.fn(async () => false),
      reset: vi.fn(async () => {}),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      conversationStore,
      engine: { run: vi.fn() },
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const response = await service.handle(createIncomingMessage("5", "/status", "status"));

    expect(response.text).toContain("Current conversation:");
    expect(response.text).toContain("Messages: 1");
    expect(response.text).toContain("Working directory: /workspace/app");
    expect(response.text).toContain("Restore points available: 1");
  });

  it("lists restore points and restores a selected backup by index", async () => {
    const backups = [
      {
        id: "conversation.json.2026-04-05T00-03-04.000Z.bak",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:03:00.000Z",
        agentId: "default",
        messageCount: 2,
      },
      {
        id: "conversation.json.2026-04-05T00-02-04.000Z.bak",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:02:00.000Z",
        agentId: "default",
        messageCount: 1,
      },
    ];
    const conversationStore: ConversationStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      listBackups: vi.fn(async () => backups),
      restore: vi.fn(async () => true),
      reset: vi.fn(async () => {}),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      conversationStore,
      engine: { run: vi.fn() },
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const historyResponse = await service.handle(createIncomingMessage("6", "/history", "history"));
    const restoreResponse = await service.handle(
      createIncomingMessage("7", "/restore 2", "restore", "2"),
    );

    expect(historyResponse.text).toContain("1. 2026-04-05T00:03:00.000Z | 2 messages | agent default");
    expect(historyResponse.text).toContain("Use /restore <n> to restore one of these backups.");
    expect(conversationStore.restore).toHaveBeenCalledWith(
      {
        transport: "telegram",
        externalId: "42",
      },
      "conversation.json.2026-04-05T00-02-04.000Z.bak",
    );
    expect(restoreResponse.text).toContain("Restored backup 2.");
    expect(restoreResponse.text).toContain("previously active conversation was backed up");
  });

  it("returns restore usage when the index is missing or invalid", async () => {
    const conversationStore: ConversationStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      listBackups: vi.fn(async () => [
        {
          id: "conversation.json.2026-04-05T00-03-04.000Z.bak",
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:03:00.000Z",
          agentId: "default",
          messageCount: 2,
        },
      ]),
      restore: vi.fn(async () => true),
      reset: vi.fn(async () => {}),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      conversationStore,
      engine: { run: vi.fn() },
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const response = await service.handle(
      createIncomingMessage("8", "/restore nope", "restore", "nope"),
    );

    expect(response.text).toContain("Usage: /restore <n>");
    expect(conversationStore.restore).not.toHaveBeenCalled();
  });

  it("supports identity, rename, clear, and export commands", async () => {
    const conversationStore = createMutableConversationStore({
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        agentId: "default",
        title: "Old title",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:01:00.000Z",
        workingDirectory: "/workspace/app",
        version: 1,
      },
      messages: [
        {
          id: "msg-1",
          role: "user" as const,
          text: "hello",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    });

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      conversationStore,
      engine: { run: vi.fn() },
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const whoami = await service.handle(createIncomingMessage("9", "/whoami", "whoami"));
    const renamed = await service.handle(
      createIncomingMessage("10", "/rename Project Alpha", "rename", "Project Alpha"),
    );
    const exported = await service.handle(createIncomingMessage("11", "/export", "export"));
    const cleared = await service.handle(createIncomingMessage("12", "/clear", "clear"));

    expect(whoami.text).toContain("User ID: 7");
    expect(whoami.text).toContain("Current agent: default");
    expect(renamed.text).toContain('Renamed the current conversation to "Project Alpha".');
    expect(exported.text).toContain("Conversation export");
    expect(exported.text).toContain("Title: Project Alpha");
    expect(cleared.text).toContain("Cleared the active conversation.");
    expect(await conversationStore.get({ transport: "telegram", externalId: "42" })).toMatchObject({
      state: {
        agentId: "default",
        title: "Project Alpha",
      },
      messages: [],
    });
  });

  it("shows config, ping, agent state, and recent logs", async () => {
    const conversationStore = createMutableConversationStore({
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:01:00.000Z",
        version: 1,
      },
      messages: [],
    });
    const loadAppConfigMock = vi.fn(async () => ({
      instance: { name: "dev" },
      paths: { dataRoot: "/var/lib/imp" },
      defaults: { agentId: "default" },
      agents: [],
      bots: [],
    }));
    const readRecentLogLinesMock = vi.fn(async () => ['{"level":"info","message":"ok"}']);

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([createDefaultAgent(), createAgent("ops")]),
      conversationStore,
      engine: { run: vi.fn() },
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
      loadAppConfig: loadAppConfigMock as never,
      readRecentLogLines: readRecentLogLinesMock,
    });

    const ping = await service.handle(createIncomingMessage("13", "/ping", "ping"));
    const config = await service.handle(createIncomingMessage("14", "/config", "config"));
    const agentBefore = await service.handle(createIncomingMessage("15", "/agent", "agent"));
    const agentAfter = await service.handle(createIncomingMessage("16", "/agent ops", "agent", "ops"));
    const logs = await service.handle(createIncomingMessage("17", "/logs 5", "logs", "5"));

    expect(ping.text).toContain("pong");
    expect(config.text).toContain("Instance: dev");
    expect(config.text).toContain("Config path: /tmp/config.json");
    expect(agentBefore.text).toContain("Available: default, ops");
    expect(agentAfter.text).toContain('Switched the current conversation to agent "ops".');
    expect(logs.text).toContain('{"level":"info","message":"ok"}');
    expect(readRecentLogLinesMock).toHaveBeenCalledWith("/tmp/private-telegram.log", 5);
  });

  it("returns scheduled delivery actions for reload and restart", async () => {
    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([createDefaultAgent()]),
      conversationStore: createMutableConversationStore(),
      engine: { run: vi.fn() },
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const reload = await service.handle(createIncomingMessage("18", "/reload", "reload"));
    const restart = await service.handle(createIncomingMessage("19", "/restart", "restart"));

    expect(reload.deliveryAction).toBe("reload");
    expect(reload.text).toContain("Reload scheduled.");
    expect(restart.deliveryAction).toBe("restart");
    expect(restart.text).toContain("Restart scheduled.");
  });
});

function createDefaultAgent(): AgentDefinition {
  return createAgent("default");
}

function createAgent(id: string): AgentDefinition {
  return {
    id,
    name: id === "default" ? "Default" : id,
    systemPrompt: "You are concise.",
    model: {
      provider: "test",
      modelId: "stub",
    },
    tools: [],
    extensions: [],
  };
}

function createRuntimeInfo() {
  return {
    botId: "private-telegram",
    configPath: "/tmp/config.json",
    dataRoot: "/tmp/data",
    logFilePath: "/tmp/private-telegram.log",
    loggingLevel: "info" as const,
    activeBotIds: ["private-telegram", "ops-telegram"],
  };
}

function createMutableConversationStore(
  initial?: Awaited<ReturnType<ConversationStore["get"]>>,
): ConversationStore {
  let current = initial;

  return {
    get: vi.fn(async () => current),
    put: vi.fn(async (context) => {
      current = context;
    }),
    listBackups: vi.fn(async () => []),
    restore: vi.fn(async () => false),
    reset: vi.fn(async () => {
      current = undefined;
    }),
  };
}

function createIncomingMessage(
  messageId: string,
  text: string,
  command?: IncomingMessage["command"],
  commandArgs?: string,
): IncomingMessage {
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
    ...(command ? { command } : {}),
    ...(commandArgs ? { commandArgs } : {}),
  };
}
