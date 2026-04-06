import { describe, expect, it } from "vitest";
import { agentCommandHandler } from "./agent-command.js";
import {
  createCommandContext,
  createDependencies,
  createIncomingMessage,
  createMutableConversationStore,
} from "./test-helpers.js";

describe("agentCommandHandler", () => {
  it("switches the active session agent", async () => {
    const store = createMutableConversationStore({
      state: {
        conversation: { transport: "telegram", externalId: "42", sessionId: "session-1" },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 1,
      },
      messages: [],
    });
    const context = createCommandContext({
      message: createIncomingMessage("agent", "ops"),
      dependencies: createDependencies({ conversationStore: store }),
    });

    const response = await agentCommandHandler.handle(context);

    expect(agentCommandHandler.canHandle("agent")).toBe(true);
    expect(response?.text).toContain('Switched the active session to agent "ops".');
    const next = await store.get(context.message.conversation);
    expect(next?.state.agentId).toBe("ops");
  });
});
