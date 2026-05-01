import { describe, expect, it, vi } from "vitest";
import { compactCommandHandler } from "./compact-command.js";
import {
  createCommandContext,
  createDependencies,
  createIncomingMessage,
  createMutableConversationStore,
} from "./test-helpers.js";
import type { AgentEngine } from "../../runtime/types.js";

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
});

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
