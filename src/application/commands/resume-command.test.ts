import { describe, expect, it, vi } from "vitest";
import type { ConversationContext } from "../../domain/conversation.js";
import { previousCommandHandler, resumeCommandHandler } from "./resume-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("resumeCommandHandler", () => {
  it("resumes a session from history and replays only the last visible user and assistant messages", async () => {
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
    expect(response?.text).toContain("**Resume**");
    expect(response?.text).toContain("Session: deploy prep (#1)");
    expect(response?.text).not.toContain("backed up");
    expect(response?.text).toContain("Agent: `ops`");
    expect(response?.replay).toEqual([
      { role: "user", text: "latest question", createdAt: "2026-04-05T00:00:40.000Z" },
      { role: "assistant", text: "latest answer", createdAt: "2026-04-05T00:00:50.000Z" },
    ]);
  });

  it("/previous resumes the most recent previous session", async () => {
    const resume = vi.fn(async () => true);
    const context = createCommandContext({
      message: createIncomingMessage("previous"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => createResumedConversation(),
          put: async () => {},
          listBackups: async () => [
            {
              id: "session-1",
              sessionId: "session-1",
              title: "latest",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:03:00.000Z",
              agentId: "ops",
              messageCount: 2,
            },
            {
              id: "session-2",
              sessionId: "session-2",
              title: "older",
              createdAt: "2026-04-04T00:00:00.000Z",
              updatedAt: "2026-04-04T00:03:00.000Z",
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

    const response = await previousCommandHandler.handle(context);

    expect(previousCommandHandler.canHandle("previous")).toBe(true);
    expect(resume).toHaveBeenCalledWith(context.message.conversation, "session-1");
    expect(response?.text).toContain("Session: latest (#1)");
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

    expect(response?.text).toContain("Session: untitled (#1)");
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
    expect(response?.text).toContain("Usage: `/resume <n>`");
  });

  it("renders session-based usage when no history is available", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("resume"),
      dependencies: createDependencies({}),
    });

    const response = await resumeCommandHandler.handle(context);

    expect(response?.text).toContain("No previous sessions are available yet.");
    expect(response?.text).toContain("Next: `/new [title]`");
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
      {
        id: "msg-4",
        role: "user",
        content: "latest question",
        timestamp: Date.parse("2026-04-05T00:00:40.000Z"),
        createdAt: "2026-04-05T00:00:40.000Z",
      },
      {
        id: "msg-5",
        role: "assistant",
        content: [{ type: "text", text: "latest answer" }],
        timestamp: Date.parse("2026-04-05T00:00:50.000Z"),
        createdAt: "2026-04-05T00:00:50.000Z",
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
    ],
  };
}
