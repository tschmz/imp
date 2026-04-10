import { describe, expect, it } from "vitest";
import { resetCommandHandler } from "./reset-command.js";
import { createCommandContext, createDependencies, createMutableConversationStore, createIncomingMessage } from "./test-helpers.js";

describe("resetCommandHandler", () => {
  it("resets the current session messages while preserving title and agent", async () => {
    const originalCreatedAt = "2026-04-01T00:00:00.000Z";
    const originalUpdatedAt = "2026-04-02T00:00:00.000Z";
    const resetAt = "2026-04-05T00:00:00.000Z";
    const conversationStore = createMutableConversationStore({
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
          sessionId: "session-1",
        },
        agentId: "ops",
        title: "Sprint planning",
        createdAt: originalCreatedAt,
        updatedAt: originalUpdatedAt,
        version: 1,
      },
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "hello",
          timestamp: Date.parse("2026-04-02T00:00:00.000Z"),
          createdAt: "2026-04-02T00:00:00.000Z",
        },
      ],
    });
    const context = createCommandContext({
      message: createIncomingMessage("reset"),
      dependencies: createDependencies({ conversationStore }),
    });

    const response = await resetCommandHandler.handle(context);
    const updated = await conversationStore.get(context.message.conversation);

    expect(resetCommandHandler.canHandle("reset")).toBe(true);
    expect(response?.text).toContain("Reset the messages in the current session.");
    expect(updated?.messages).toEqual([]);
    expect(updated?.state.agentId).toBe("ops");
    expect(updated?.state.title).toBe("Sprint planning");
    expect(updated?.state.conversation).toEqual({
      transport: "telegram",
      externalId: "42",
      sessionId: "session-1",
    });
    expect(updated?.state.createdAt).toBe(originalCreatedAt);
    expect(updated?.state.updatedAt).toBe(resetAt);
  });

  it("returns a clear message when there is no active session", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("reset"),
      dependencies: createDependencies({}),
    });

    const response = await resetCommandHandler.handle(context);

    expect(response?.text).toBe("There is no active session whose messages can be reset.");
  });
});
