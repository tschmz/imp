import { describe, expect, it } from "vitest";
import { statusCommandHandler } from "./status-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("statusCommandHandler", () => {
  it("renders current state and backups", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("status"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: {
              conversation: { transport: "telegram", externalId: "42" },
              agentId: "default",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:01:00.000Z",
              version: 1,
            },
            messages: [],
          }),
          put: async () => {},
          listBackups: async () => [
            {
              id: "backup-1",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:03:00.000Z",
              agentId: "default",
              messageCount: 2,
            },
          ],
          restore: async () => false,
          reset: async () => {},
        },
      }),
    });

    const response = await statusCommandHandler.handle(context);

    expect(statusCommandHandler.canHandle("status")).toBe(true);
    expect(response?.text).toContain("Current conversation:");
    expect(response?.text).toContain("Restore points available: 1");
  });
});
