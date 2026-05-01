import { describe, expect, it, vi } from "vitest";
import { compactCommandHandler } from "./compact-command.js";
import {
  createCommandContext,
  createDependencies,
  createIncomingMessage,
  createMutableConversationStore,
} from "./test-helpers.js";
import type { ConversationContext, ConversationEvent } from "../../domain/conversation.js";
import type { AgentEngine } from "../../runtime/types.js";
import type { ConversationStore } from "../../storage/types.js";

describe("compactCommandHandler", () => {
  it("summarizes old session messages and stores compaction metadata", async () => {
    const conversationStore = createMutableConversationStore({
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
      messages: [
        createUserMessage("u1", "Plan the release", "2026-04-05T00:00:00.000Z"),
        createAssistantMessage("a1", "We need checks.", "2026-04-05T00:01:00.000Z"),
        createUserMessage("u2", "Continue", "2026-04-05T00:02:00.000Z"),
        createAssistantMessage("a2", "Next run tests.", "2026-04-05T00:03:00.000Z"),
      ],
    });
    const run = vi.fn<AgentEngine["run"]>(async () => ({
      message: {
        conversation: createIncomingMessage("compact").conversation,
        text: "## Goal\nShip the release.\n\n## Next Steps\n1. Run tests.",
      },
      conversationEvents: [],
    }));
    const engine: AgentEngine = {
      run,
    };
    const context = createCommandContext({
      message: createIncomingMessage("compact", "focus on release state"),
      dependencies: createDependencies({ conversationStore, engine }),
    });

    const response = await compactCommandHandler.handle(context);
    const updated = await conversationStore.get(context.message.conversation);

    expect(compactCommandHandler.canHandle("compact")).toBe(true);
    expect(response?.text).toContain("Compacted the current session.");
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].message.text).toContain("focus on release state");
    expect(updated?.messages).toHaveLength(4);
    expect(updated?.state.compaction).toMatchObject({
      summary: expect.stringContaining("Ship the release."),
      firstKeptMessageId: "u2",
      compactedThroughMessageId: "a1",
      messageCountBefore: 4,
      messageCountSummarized: 2,
      messageCountKept: 2,
      sequence: 1,
    });
  });

  it("returns a clear message when there is no active session", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("compact"),
      dependencies: createDependencies({}),
    });

    const response = await compactCommandHandler.handle(context);

    expect(response?.text).toBe("There is no active session to compact.");
  });

  it("compacts an explicitly addressed session instead of the active agent session", async () => {
    const activeSession = createConversation("active-session", [
      createUserMessage("active-u1", "Active session plan", "2026-04-05T00:00:00.000Z"),
      createAssistantMessage("active-a1", "Active response", "2026-04-05T00:01:00.000Z"),
      createUserMessage("active-u2", "Active next", "2026-04-05T00:02:00.000Z"),
      createAssistantMessage("active-a2", "Active follow-up", "2026-04-05T00:03:00.000Z"),
    ]);
    const targetSession = createConversation("target-session", [
      createUserMessage("target-u1", "Target session plan", "2026-04-05T00:00:00.000Z"),
      createAssistantMessage("target-a1", "Target response", "2026-04-05T00:01:00.000Z"),
      createUserMessage("target-u2", "Target next", "2026-04-05T00:02:00.000Z"),
      createAssistantMessage("target-a2", "Target follow-up", "2026-04-05T00:03:00.000Z"),
    ]);
    const sessions = new Map<string, ConversationContext>([
      ["active-session", activeSession],
      ["target-session", targetSession],
    ]);
    const conversationStore: ConversationStore = {
      get: async (ref) => ref.sessionId ? sessions.get(ref.sessionId) : undefined,
      put: async (context) => {
        sessions.set(context.state.conversation.sessionId!, context);
      },
      listBackups: async () => [],
      restore: async () => false,
      ensureActive: async () => {
        throw new Error("not used");
      },
      create: async () => {
        throw new Error("not used");
      },
      getSelectedAgent: async () => "default",
      getActiveForAgent: async () => sessions.get("active-session"),
      listBackupsForAgent: async () => [],
      restoreForAgent: async () => false,
    };
    const run = vi.fn<AgentEngine["run"]>(async () => ({
      message: {
        conversation: createIncomingMessage("compact").conversation,
        text: "## Goal\nCompact the target session.",
      },
      conversationEvents: [],
    }));
    const message = createIncomingMessage("compact", "target focus");
    const context = createCommandContext({
      message: {
        ...message,
        conversation: {
          ...message.conversation,
          sessionId: "target-session",
        },
      },
      dependencies: createDependencies({
        conversationStore,
        engine: { run },
      }),
    });

    const response = await compactCommandHandler.handle(context);

    expect(response?.text).toContain("Compacted the current session.");
    expect(run.mock.calls[0]?.[0].message.text).toContain("Target session plan");
    expect(run.mock.calls[0]?.[0].message.text).not.toContain("Active session plan");
    expect(sessions.get("target-session")?.state.compaction).toMatchObject({
      firstKeptMessageId: "target-u2",
      compactedThroughMessageId: "target-a1",
    });
    expect(sessions.get("active-session")?.state.compaction).toBeUndefined();
  });
});

function createConversation(sessionId: string, messages: ConversationEvent[]): ConversationContext {
  return {
    state: {
      conversation: {
        transport: "telegram",
        externalId: "42",
        sessionId,
      },
      agentId: "default",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:03:00.000Z",
      version: 1,
    },
    messages,
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
