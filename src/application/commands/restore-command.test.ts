import { describe, expect, it, vi } from "vitest";
import { restoreCommandHandler } from "./restore-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("restoreCommandHandler", () => {
  it("restores a session from history and includes its title", async () => {
    const restore = vi.fn(async () => true);
    const context = createCommandContext({
      message: createIncomingMessage("restore", "1"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => undefined,
          put: async () => {},
          listBackups: async () => [
            {
              id: "session-1",
              sessionId: "session-1",
              title: "deploy prep",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:03:00.000Z",
              agentId: "ops",
              messageCount: 2,
            },
          ],
          restore,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
      }),
    });

    const response = await restoreCommandHandler.handle(context);

    expect(restore).toHaveBeenCalledWith(context.message.conversation, "session-1");
    expect(response?.text).toContain("Restored session 1: deploy prep");
    expect(response?.text).not.toContain("backed up");
    expect(response?.text).toContain("Agent: ops");
  });

  it("falls back to untitled when the restored session has no title", async () => {
    const restore = vi.fn(async () => true);
    const context = createCommandContext({
      message: createIncomingMessage("restore", "1"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => undefined,
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
          restore,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
      }),
    });

    const response = await restoreCommandHandler.handle(context);

    expect(response?.text).toContain("Restored session 1: untitled");
  });

  it("rejects partially numeric session selections", async () => {
    const restore = vi.fn(async () => true);
    const context = createCommandContext({
      message: createIncomingMessage("restore", "1abc"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => undefined,
          put: async () => {},
          listBackups: async () => [
            {
              id: "session-1",
              sessionId: "session-1",
              title: "deploy prep",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:03:00.000Z",
              agentId: "ops",
              messageCount: 2,
            },
          ],
          restore,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
      }),
    });

    const response = await restoreCommandHandler.handle(context);

    expect(restore).not.toHaveBeenCalled();
    expect(response?.text).toContain("Usage: /restore <n>");
  });

  it("renders session-based usage when no history is available", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("restore"),
      dependencies: createDependencies({}),
    });

    const response = await restoreCommandHandler.handle(context);

    expect(response?.text).toContain("No previous sessions are available yet.");
    expect(response?.text).toContain("/new to start another session");
  });
});
