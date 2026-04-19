import { describe, expect, it, vi } from "vitest";
import type { ConversationContext } from "../../domain/conversation.js";
import { resumeCommandHandler } from "./resume-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("resumeCommandHandler", () => {
  it("resumes a session from history and includes visible replay messages", async () => {
    const resume = vi.fn(async () => true);
    const context = createCommandContext({
      message: createIncomingMessage("resume", "1"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => createResumedConversation(),
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
          restore: resume,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
      }),
    });

    const response = await resumeCommandHandler.handle(context);

    expect(resume).toHaveBeenCalledWith(context.message.conversation, "session-1");
    expect(response?.text).toContain("Resumed session 1: deploy prep");
    expect(response?.text).not.toContain("backed up");
    expect(response?.text).toContain("Agent: ops");
    expect(response?.replay).toEqual([
      { role: "user", text: "old question", createdAt: "2026-04-05T00:00:10.000Z" },
      { role: "assistant", text: "old answer", createdAt: "2026-04-05T00:00:20.000Z" },
    ]);
  });

  it("falls back to untitled when the resumed session has no title", async () => {
    const resume = vi.fn(async () => true);
    const context = createCommandContext({
      message: createIncomingMessage("resume", "1"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => createResumedConversation(),
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
          restore: resume,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
      }),
    });

    const response = await resumeCommandHandler.handle(context);

    expect(response?.text).toContain("Resumed session 1: untitled");
  });

  it("rejects partially numeric session selections", async () => {
    const resume = vi.fn(async () => true);
    const context = createCommandContext({
      message: createIncomingMessage("resume", "1abc"),
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
          restore: resume,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
      }),
    });

    const response = await resumeCommandHandler.handle(context);

    expect(resume).not.toHaveBeenCalled();
    expect(response?.text).toContain("Usage: /resume <n>");
  });

  it("renders session-based usage when no history is available", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("resume"),
      dependencies: createDependencies({}),
    });

    const response = await resumeCommandHandler.handle(context);

    expect(response?.text).toContain("No previous sessions are available yet.");
    expect(response?.text).toContain("/new to start another session");
  });
});

function createResumedConversation(): ConversationContext {
  return {
    state: {
      conversation: { transport: "telegram", externalId: "42", sessionId: "session-1" },
      agentId: "ops",
      title: "deploy prep",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:03:00.000Z",
      version: 1,
    },
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "old question",
        timestamp: Date.parse("2026-04-05T00:00:10.000Z"),
        createdAt: "2026-04-05T00:00:10.000Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden", thinkingSignature: "sig" },
          { type: "text", text: "old answer" },
          { type: "toolCall", id: "call-1", name: "shell", arguments: { cmd: "npm test" } },
        ],
        timestamp: Date.parse("2026-04-05T00:00:20.000Z"),
        createdAt: "2026-04-05T00:00:20.000Z",
        api: "test",
        provider: "test",
        model: "stub",
        stopReason: "stop",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
      {
        id: "msg-3",
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "shell",
        isError: false,
        content: [{ type: "text", text: "tool output" }],
        timestamp: Date.parse("2026-04-05T00:00:30.000Z"),
        createdAt: "2026-04-05T00:00:30.000Z",
      },
    ],
  };
}
