import { describe, expect, it } from "vitest";
import { deleteCommandHandler } from "./delete-command.js";
import { createCommandContext, createDependencies, createMutableConversationStore, createIncomingMessage } from "./test-helpers.js";

describe("deleteCommandHandler", () => {
  it("deletes the current session", async () => {
    const conversationStore = createMutableConversationStore({
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
          sessionId: "session-1",
        },
        agentId: "ops",
        title: "Sprint planning",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
        version: 1,
      },
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "hello",
          createdAt: "2026-04-02T00:00:00.000Z",
        },
      ],
    });
    const context = createCommandContext({
      message: createIncomingMessage("delete"),
      dependencies: createDependencies({ conversationStore }),
    });

    const response = await deleteCommandHandler.handle(context);
    const deleted = await conversationStore.get(context.message.conversation);

    expect(deleteCommandHandler.canHandle("delete")).toBe(true);
    expect(response?.text).toContain("**Delete**");
    expect(response?.text).toContain("Deleted session: `session-1`");
    expect(response?.text).toContain("Agent: `ops`");
    expect(response?.text).toContain("Title: Sprint planning");
    expect(deleted).toBeUndefined();
  });

  it("returns a clear message when there is no active session", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("delete"),
      dependencies: createDependencies({}),
    });

    const response = await deleteCommandHandler.handle(context);

    expect(response?.text).toBe(["**Delete**", "No active session to delete."].join("\n"));
  });
});
