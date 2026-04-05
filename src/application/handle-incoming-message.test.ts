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

  it("fails when the default agent cannot be resolved", () => {
    expect(() =>
      createHandleIncomingMessage({
        agentRegistry: createAgentRegistry([]),
        conversationStore: {
          get: vi.fn(),
          put: vi.fn(),
        },
        engine: {
          run: vi.fn(),
        },
        defaultAgentId: "missing",
      }),
    ).toThrow("Unknown default agent: missing");
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
