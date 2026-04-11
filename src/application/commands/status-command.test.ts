import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "../../agents/registry.js";
import type { ConversationContext } from "../../domain/conversation.js";
import { statusCommandHandler } from "./status-command.js";
import { createCommandContext, createDefaultAgent, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("statusCommandHandler", () => {
  const baseConversationState = {
    conversation: { transport: "telegram", externalId: "42", sessionId: "session-1" },
    agentId: "default",
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:01:00.000Z",
    version: 1,
  } satisfies ConversationContext["state"];

  it("renders active session state and history count", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("status"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: baseConversationState,
            messages: [],
          }),
          put: async () => {},
          listBackups: async () => [
            {
              id: "backup-1",
              sessionId: "backup-1",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:03:00.000Z",
              agentId: "default",
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

    const response = await statusCommandHandler.handle(context);

    expect(statusCommandHandler.canHandle("status")).toBe(true);
    expect(response?.text).toContain("Active session:");
    expect(response?.text).toContain("Sessions in history: 1");
  });

  it("renders aggregated LLM usage across assistant messages", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("status"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: baseConversationState,
            messages: [
              {
                kind: "message",
                id: "msg-1",
                role: "user",
                content: "hello",
                createdAt: "2026-04-05T00:00:10.000Z",
                timestamp: Date.parse("2026-04-05T00:00:10.000Z"),
              },
              {
                kind: "message",
                id: "msg-2",
                role: "assistant",
                content: [{ type: "text", text: "hi" }],
                createdAt: "2026-04-05T00:00:20.000Z",
                timestamp: Date.parse("2026-04-05T00:00:20.000Z"),
                api: "test",
                provider: "test",
                model: "stub",
                stopReason: "stop",
                usage: {
                  input: 100,
                  output: 25,
                  cacheRead: 40,
                  cacheWrite: 10,
                  totalTokens: 175,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              },
              {
                kind: "message",
                id: "msg-3",
                role: "assistant",
                content: [{ type: "text", text: "again" }],
                createdAt: "2026-04-05T00:00:30.000Z",
                timestamp: Date.parse("2026-04-05T00:00:30.000Z"),
                api: "test",
                provider: "test",
                model: "stub",
                stopReason: "stop",
                usage: {
                  input: 11,
                  output: 7,
                  cacheRead: 3,
                  cacheWrite: 2,
                  totalTokens: 23,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              },
            ],
          }),
          put: async () => {},
          listBackups: async () => [],
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

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain(
      [
        "LLM usage:",
        "Total tokens: 198",
        "input: 111",
        "output: 32",
        "cacheRead: 43",
        "cacheWrite: 12",
      ].join("\n"),
    );
  });

  it("renders zero LLM usage before assistant usage exists", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("status"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: baseConversationState,
            messages: [
              {
                kind: "message",
                id: "msg-1",
                role: "user",
                content: "hello",
                createdAt: "2026-04-05T00:00:10.000Z",
                timestamp: Date.parse("2026-04-05T00:00:10.000Z"),
              },
            ],
          }),
          put: async () => {},
          listBackups: async () => [],
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

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain(
      [
        "LLM usage:",
        "Total tokens: 0",
        "input: 0",
        "output: 0",
        "cacheRead: 0",
        "cacheWrite: 0",
      ].join("\n"),
    );
  });

  it("falls back to the agent workspace for the working directory", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("status"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: baseConversationState,
            messages: [],
          }),
          put: async () => {},
          listBackups: async () => [],
          restore: async () => false,
          ensureActive: async () => {
            throw new Error("not used");
          },
          create: async () => {
            throw new Error("not used");
          },
        },
        agentRegistry: createAgentRegistry([
          {
            ...createDefaultAgent(),
            workspace: { cwd: "/workspace/project" },
          },
          createDefaultAgent("ops"),
        ]),
      }),
    });

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain("Working directory: /workspace/project");
  });
});
