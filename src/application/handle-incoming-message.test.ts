import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { IncomingMessage } from "../domain/message.js";
import type { AgentEngine } from "../runtime/types.js";
import type { ConversationStore } from "../storage/types.js";
import { createHandleIncomingMessage } from "./handle-incoming-message.js";

describe("createHandleIncomingMessage", () => {
  it("routes known inbound commands to the command registry", async () => {
    const agent = createDefaultAgent();
    const conversationStore: ConversationStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
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
    };

    const engine: AgentEngine = {
      run: vi.fn(async () => {
        throw new Error("engine should not run for /help");
      }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const response = await service.handle(createIncomingMessage("1", "/help", "help"));

    expect(response.text).toContain("Available commands:");
    expect(engine.run).not.toHaveBeenCalled();
  });

  it("falls back to normal agent processing when no command handler matches", async () => {
    const agent = createDefaultAgent();
    const byConversation = new Map<string, Awaited<ReturnType<ConversationStore["get"]>>>();

    const conversationStore: ConversationStore = {
      get: vi.fn(async (ref) =>
        "sessionId" in ref
          ? byConversation.get(`${ref.externalId}:${ref.sessionId}`)
          : [...byConversation.values()][0],
      ),
      put: vi.fn(async (context) => {
        byConversation.set(
          `${context.state.conversation.externalId}:${context.state.conversation.sessionId}`,
          context,
        );
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async (ref, options) => {
        const existing = [...byConversation.values()][0];
        if (existing) {
          return existing;
        }

        const context = {
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
        };
        byConversation.set(`${ref.externalId}:session-1`, context);
        return context;
      }),
      create: vi.fn(async (ref, options) => {
        const context = {
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
        };
        byConversation.set(`${ref.externalId}:session-1`, context);
        return context;
      }),
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

    const response = await service.handle(createIncomingMessage("2", "/unknown", undefined));

    expect(response.text).toBe("reply");
    expect(engine.run).toHaveBeenCalledTimes(1);
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
          ensureActive: vi.fn(),
          create: vi.fn(),
        },
        engine: {
          run: vi.fn(),
        },
        defaultAgentId: "missing",
        runtimeInfo: createRuntimeInfo(),
      }),
    ).toThrow("Unknown default agent: missing");
  });
});

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
