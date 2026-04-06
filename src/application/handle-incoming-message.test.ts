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
    });

    const response = await service.handle(createIncomingMessage("8", "/restore nope", "restore", "nope"));

    expect(response.text).toContain("Usage: /restore <n>");
    expect(conversationStore.restore).not.toHaveBeenCalled();
  });
});

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
