import { describe, expect, it } from "vitest";
import { historyCommandHandler } from "./history-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("historyCommandHandler", () => {
  it("renders previous sessions and the active session", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("history"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: {
              conversation: { transport: "telegram", externalId: "42", sessionId: "session-2" },
              agentId: "default",
              title: "Current work",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:05:00.000Z",
              version: 1,
            },
            messages: [{ id: "m1", role: "user", text: "hi", createdAt: "2026-04-05T00:04:00.000Z" }],
          }),
          put: async () => {},
          listBackups: async () => [
            {
              id: "session-1",
              sessionId: "session-1",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:03:00.000Z",
              agentId: "ops",
              messageCount: 2,
            },
          ],
          restore: async () => false,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
      }),
    });

    const response = await historyCommandHandler.handle(context);

    expect(historyCommandHandler.canHandle("history")).toBe(true);
    expect(response?.text).toContain("Session history:");
    expect(response?.text).toContain("Active: Current work with 1 messages");
    expect(response?.text).toContain("Previous sessions:");
    expect(response?.text).toContain("Use /restore <n> to switch to one of these sessions.");
  });
});
