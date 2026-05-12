import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import { createDeliveryRouter } from "../transports/delivery-router.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import { recoverInterruptedRuns } from "./runtime-recovery.js";

describe("recoverInterruptedRuns", () => {
  it("delivers recovered responses when the recovered conversation is still active", async () => {
    const conversation = createInterruptedConversation("session-1", "default");
    const deliver = vi.fn(async () => undefined);
    const runtime = createRuntime({
      interruptedRuns: [conversation],
      selectedAgentId: "default",
      activeConversation: conversation,
    });
    const deliveryRouter = createDeliveryRouter();
    deliveryRouter.register("private-telegram", { deliver });

    await recoverInterruptedRuns(runtime, {
      agentRegistry: createAgentRegistry([createTestAgent("default")]),
      deliveryRouter,
      replyChannel: { kind: "telegram", delivery: "endpoint", endpointId: "private-telegram" },
    });

    expect(deliver).toHaveBeenCalledWith({
      endpointId: "private-telegram",
      target: { conversationId: "42" },
      message: {
        conversation: expect.objectContaining({ sessionId: "session-1", agentId: "default" }),
        text: "recovered reply",
      },
    });
  });

  it("suppresses recovered responses when another session became active", async () => {
    const staleConversation = createInterruptedConversation("session-1", "default");
    const activeConversation = createInterruptedConversation("session-2", "default");
    const deliver = vi.fn(async () => undefined);
    const runtime = createRuntime({
      interruptedRuns: [staleConversation],
      selectedAgentId: "default",
      activeConversation,
    });
    const deliveryRouter = createDeliveryRouter();
    deliveryRouter.register("private-telegram", { deliver });

    await recoverInterruptedRuns(runtime, {
      agentRegistry: createAgentRegistry([createTestAgent("default")]),
      deliveryRouter,
      replyChannel: { kind: "telegram", delivery: "endpoint", endpointId: "private-telegram" },
    });

    expect(deliver).not.toHaveBeenCalled();
    expect(runtime.logger.debug).toHaveBeenCalledWith(
      "skipped stale recovered response delivery",
      expect.objectContaining({ messageId: "msg-1" }),
    );
  });
});

function createInterruptedConversation(sessionId: string, agentId: string): ConversationContext {
  return {
    state: {
      conversation: {
        endpointId: "private-telegram",
        transport: "telegram",
        externalId: "42",
        sessionId,
        agentId,
      },
      agentId,
      createdAt: "2026-04-07T12:00:00.000Z",
      updatedAt: "2026-04-07T12:01:00.000Z",
      version: 1,
      run: {
        status: "running",
        messageId: "msg-1",
        correlationId: "corr-1",
        startedAt: "2026-04-07T12:01:00.000Z",
        updatedAt: "2026-04-07T12:01:00.000Z",
      },
    },
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "continue this",
        createdAt: "2026-04-07T12:01:00.000Z",
      },
    ],
  };
}

function createRuntime(options: {
  interruptedRuns: ConversationContext[];
  selectedAgentId: string;
  activeConversation: ConversationContext;
}): BootstrappedRuntime {
  return {
    endpointConfig: {
      id: "private-telegram",
      type: "telegram",
      token: "123:abc",
      allowedUserIds: ["7"],
      defaultAgentId: "default",
      paths: {
        dataRoot: "/tmp",
        sessionsDir: "/tmp/sessions",
        bindingsDir: "/tmp/bindings",
        logsDir: "/tmp/logs",
        logFilePath: "/tmp/logs/endpoints.log",
        runtimeDir: "/tmp/runtime/endpoints",
        runtimeStatePath: "/tmp/runtime/endpoints/private-telegram.json",
      },
    },
    configPath: "/tmp/config.json",
    loggingLevel: "info",
    logger: {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
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
    conversationStore: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async () => options.activeConversation),
      create: vi.fn(async () => options.activeConversation),
      listInterruptedRuns: vi.fn(async () => options.interruptedRuns),
      updateState: vi.fn(async (context, patch) => ({
        ...context,
        state: {
          ...context.state,
          ...patch,
        },
      })),
      appendEvents: vi.fn(async (context, events) => ({
        ...context,
        messages: [...context.messages, ...events],
      })),
      getSelectedAgent: vi.fn(async () => options.selectedAgentId),
      getActiveForAgent: vi.fn(async () => options.activeConversation),
    },
    engine: {
      run: vi.fn(async ({ message }) => ({
        message: {
          conversation: message.conversation,
          text: "recovered reply",
        },
        conversationEvents: [],
      })),
      close: vi.fn(async () => undefined),
    },
  };
}

function createTestAgent(id: string): AgentDefinition {
  return {
    id,
    name: id,
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
  };
}
