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
    expect(response?.text).toContain("**New session**");
    expect(response?.text).toContain("Session: untitled");
    expect(response?.text).toContain("Previous sessions: `/history`");
  });

  it("creates a fresh session with a title when command args are provided", async () => {
    const create = vi.fn(async (ref, options) => ({
      state: {
        conversation: {
          ...ref,
          sessionId: "session-2",
        },
        agentId: options.agentId,
        ...(options.title ? { title: options.title } : {}),
        createdAt: options.now,
        updatedAt: options.now,
        version: 1,
      },
      messages: [],
    }));
    const context = createCommandContext({
      message: createIncomingMessage("new", "sprint planning"),
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

    expect(create).toHaveBeenCalledWith(context.message.conversation, {
      agentId: context.dependencies.defaultAgentId,
      now: context.message.receivedAt,
      title: "sprint planning",
    });
    expect(response?.text).toContain("Session: sprint planning");
  });
});
