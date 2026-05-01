import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../../agents/registry.js";
import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext, ConversationEvent } from "../../domain/conversation.js";
import type { IncomingMessage } from "../../domain/message.js";
import { createHookRunner } from "../../extensions/hook-runner.js";
import type { AgentEngine } from "../../runtime/types.js";
import type { ConversationStore } from "../../storage/types.js";
import { compactConversationIfNeeded } from "./compact-conversation.js";
import type { InboundProcessingContext } from "./types.js";

describe("compactConversationIfNeeded", () => {
  it("triggers automatic compaction when the incoming message pushes context over the model window", async () => {
    const agent = createDefaultAgent();
    const conversation = createConversation([
      createUserMessage("u1", `Old context marker. ${"a".repeat(8_000)}`, "2026-04-05T00:00:00.000Z"),
      createAssistantMessage("a1", "b".repeat(8_000), "2026-04-05T00:01:00.000Z"),
      createUserMessage("u2", "c".repeat(12_000), "2026-04-05T00:02:00.000Z"),
      createAssistantMessage("a2", "d".repeat(12_000), "2026-04-05T00:03:00.000Z"),
    ]);
    const updateState = vi.fn<NonNullable<ConversationStore["updateState"]>>(
      async (context, patch) => ({
        ...context,
        state: {
          ...context.state,
          ...patch,
        },
      }),
    );
    const conversationStore = createConversationStore({ updateState });
    const run = vi.fn<AgentEngine["run"]>(async ({ message }) => ({
      message: {
        conversation: message.conversation,
        text: "Short checkpoint.",
      },
      conversationEvents: [],
    }));
    const context = createProcessingContext({
      agent,
      conversation,
      conversationStore,
      engine: { run },
      message: createIncomingMessage("incoming overflow trigger ".concat("e".repeat(12_000))),
    });

    await compactConversationIfNeeded(context);

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].message.text).toContain("Old context marker.");
    expect(run.mock.calls[0]?.[0].message.text).not.toContain("incoming overflow trigger");
    expect(updateState).toHaveBeenCalledOnce();
    expect(context.conversation?.state.compaction).toMatchObject({
      summary: "Short checkpoint.",
      firstKeptMessageId: "u2",
      compactedThroughMessageId: "a1",
      messageCountSummarized: 2,
      messageCountKept: 2,
    });
  });
});

function createProcessingContext(options: {
  agent: AgentDefinition;
  conversation: ConversationContext;
  conversationStore: ConversationStore;
  engine: AgentEngine;
  message: IncomingMessage;
}): InboundProcessingContext {
  return {
    message: options.message,
    dependencies: {
      agentRegistry: createAgentRegistry([options.agent]),
      conversationStore: options.conversationStore,
      engine: options.engine,
      defaultAgentId: options.agent.id,
      runtimeInfo: {
        endpointId: "private-telegram",
        configPath: "/tmp/config.json",
        dataRoot: "/tmp/data",
        logFilePath: "/tmp/private-telegram.log",
        loggingLevel: "info",
        activeEndpointIds: ["private-telegram"],
      },
      resolveModel: () =>
        ({
          id: "stub",
          name: "Stub",
          api: "openai-responses",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 20_000,
          maxTokens: 4_096,
        }) as never,
    },
    defaultAgent: options.agent,
    availableCommands: [],
    loadAppConfig: async () => {
      throw new Error("not used");
    },
    readRecentLogLines: async () => [],
    hookRunner: createHookRunner(),
    startedAt: Date.now(),
    conversation: options.conversation,
    agent: options.agent,
    availableSkills: [],
  };
}

function createConversation(messages: ConversationEvent[]): ConversationContext {
  return {
    state: {
      conversation: {
        transport: "telegram",
        externalId: "42",
        sessionId: "session-1",
      },
      agentId: "default",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:03:00.000Z",
      version: 1,
    },
    messages,
  };
}

function createConversationStore(
  overrides: Partial<ConversationStore>,
): ConversationStore {
  return {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    listBackups: vi.fn(async () => []),
    restore: vi.fn(async () => false),
    ensureActive: vi.fn(async () => {
      throw new Error("not used");
    }),
    create: vi.fn(async () => {
      throw new Error("not used");
    }),
    ...overrides,
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

function createIncomingMessage(text: string): IncomingMessage {
  return {
    endpointId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId: "msg-1",
    correlationId: "corr-1",
    userId: "7",
    text,
    receivedAt: "2026-04-05T00:04:00.000Z",
  };
}

function createUserMessage(id: string, content: string, createdAt: string) {
  return {
    kind: "message" as const,
    id,
    role: "user" as const,
    content,
    timestamp: Date.parse(createdAt),
    createdAt,
  };
}

function createAssistantMessage(id: string, text: string, createdAt: string) {
  return {
    kind: "message" as const,
    id,
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "openai",
    model: "gpt-5-mini",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.parse(createdAt),
    createdAt,
  };
}
