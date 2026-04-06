import { describe, expect, it, vi } from "vitest";
import { newCommandHandler } from "./new-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("newCommandHandler", () => {
  it("creates and activates a fresh session", async () => {
    const create = vi.fn(async (ref, options) => ({
      state: {
        conversation: {
          ...ref,
          sessionId: "session-2",
        },
        agentId: options.agentId,
        createdAt: options.now,
        updatedAt: options.now,
        version: 1,
      },
      messages: [],
    }));
    const context = createCommandContext({
      message: createIncomingMessage("new"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => undefined,
          put: async () => {},
          listBackups: async () => [],
          restore: async () => false,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create,
        },
      }),
    });

    const response = await newCommandHandler.handle(context);

    expect(newCommandHandler.canHandle("new")).toBe(true);
    expect(create).toHaveBeenCalledWith(context.message.conversation, {
      agentId: context.dependencies.defaultAgentId,
      now: context.message.receivedAt,
    });
    expect(response?.text).toContain("Started a fresh session.");
    expect(response?.text).toContain("still available in /history");
  });
});
