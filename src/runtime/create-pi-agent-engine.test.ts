import { fauxAssistantMessage, registerFauxProvider, type FauxProviderRegistration } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import { createPiAgentEngine } from "./create-pi-agent-engine.js";

const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
  while (registrations.length > 0) {
    registrations.pop()?.unregister();
  }
});

describe("createPiAgentEngine", () => {
  it("runs a real pi agent with persisted transcript context", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe("You are concise.");
        expect(context.messages).toHaveLength(3);
        expect(context.messages[0]).toMatchObject({
          role: "user",
          content: "hello",
        });
        expect(context.messages[1]).toMatchObject({
          role: "assistant",
          content: [{ type: "text", text: "hi there" }],
        });
        expect(context.messages[2]).toMatchObject({
          role: "user",
          content: [{ type: "text", text: "what did I just say?" }],
        });
        return fauxAssistantMessage("You said hello.");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: (provider, modelId) => {
        if (provider !== "faux" || modelId !== "faux-1") {
          return undefined;
        }

        return registration.getModel("faux-1");
      },
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(result).toEqual({
      message: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        text: "You said hello.",
      },
    });
  });

  it("fails clearly when the configured model cannot be resolved", async () => {
    const engine = createPiAgentEngine({
      resolveModel: () => undefined,
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow('Unknown model for agent "default": faux/faux-1');
  });

  it("fails clearly when the assistant response contains no text", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([fauxAssistantMessage([])]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'Agent "default" produced an assistant message without text content.',
    );
  });

  it("surfaces upstream agent errors instead of masking them as empty text", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "No API key for provider: faux",
      }),
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow('Agent "default" failed: No API key for provider: faux');
  });
});

function createAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    systemPrompt: "You are concise.",
    model: {
      provider: "faux",
      modelId: "faux-1",
    },
    tools: [],
    extensions: [],
  };
}

function createConversation(): ConversationContext {
  return {
    state: {
      conversation: {
        transport: "telegram",
        externalId: "42",
      },
      agentId: "default",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
    },
    messages: [
      {
        id: "1",
        role: "user",
        text: "hello",
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        id: "1:assistant",
        role: "assistant",
        text: "hi there",
        createdAt: "2026-04-05T00:00:01.000Z",
      },
    ],
  };
}

function createIncomingMessage(): IncomingMessage {
  return {
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId: "2",
    userId: "7",
    text: "what did I just say?",
    receivedAt: "2026-04-05T00:00:02.000Z",
  };
}
