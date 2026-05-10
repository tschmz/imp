import { describe, expect, it } from "vitest";
import { forkCommandHandler } from "./fork-command.js";
import { createCommandContext, createDependencies, createIncomingMessage, createMutableConversationStore } from "./test-helpers.js";

describe("forkCommandHandler", () => {
  it("forks the current session into a new active session", async () => {
    const conversationStore = createMutableConversationStore({
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
          sessionId: "session-1",
        },
        agentId: "default",
        title: "Original",
        workingDirectory: "/work/project",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        version: 3,
        run: {
          status: "running",
          updatedAt: "2026-04-04T00:00:00.000Z",
        },
      },
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "hello",
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    const context = createCommandContext({
      message: createIncomingMessage("fork"),
      dependencies: createDependencies({ conversationStore }),
    });

    const response = await forkCommandHandler.handle(context);
    const forked = await conversationStore.get(context.message.conversation);

    expect(forkCommandHandler.canHandle("fork")).toBe(true);
    expect(response?.text).toContain("**Fork**");
    expect(response?.text).toContain("Session: Original");
    expect(response?.text).toContain("Messages: 1");
    expect(forked?.state.conversation.sessionId).not.toBe("session-1");
    expect(forked?.state.title).toBe("Original");
    expect(forked?.state.workingDirectory).toBe("/work/project");
    expect(forked?.state.createdAt).toBe(context.message.receivedAt);
    expect(forked?.state.updatedAt).toBe(context.message.receivedAt);
    expect(forked?.state.run).toBeUndefined();
    expect(forked?.messages).toHaveLength(1);
  });

  it("uses an explicit fork title", async () => {
    const conversationStore = createMutableConversationStore({
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
          sessionId: "session-1",
        },
        agentId: "default",
        title: "Original",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        version: 1,
      },
      messages: [],
    });
    const context = createCommandContext({
      message: createIncomingMessage("fork", "Experiment"),
      dependencies: createDependencies({ conversationStore }),
    });

    const response = await forkCommandHandler.handle(context);
    const forked = await conversationStore.get(context.message.conversation);

    expect(response?.text).toContain("Session: Experiment");
    expect(forked?.state.title).toBe("Experiment");
  });

  it("returns a clear message when there is no active session", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("fork"),
      dependencies: createDependencies({}),
    });

    const response = await forkCommandHandler.handle(context);

    expect(response?.text).toBe(["**Fork**", "No active session to fork."].join("\n"));
  });
});
