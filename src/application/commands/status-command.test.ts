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
    expect(response?.text).toContain("# Status");
    expect(response?.text).toContain("## Session");
    expect(response?.text).toContain("- **Turns:** 0");
    expect(response?.text).toContain("- **Events:** 0");
    expect(response?.text).not.toContain("Sessions in history");
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
        resolveModel: () =>
          ({
            id: "stub",
            name: "Stub",
            api: "test",
            provider: "test",
            baseUrl: "https://example.invalid",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          }) as never,
      }),
    });

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain("## Usage");
    expect(response?.text).toContain("- **Tokens:** 198 total · 111 input · 32 output");
    expect(response?.text).toContain("- **Cache:** 43 read · 12 write");
    expect(response?.text).toContain("## Last LLM turn");
    expect(response?.text).toContain("- **Model:** `test/stub`");
    expect(response?.text).toContain("- **Tokens:** 23 total · 11 input · 7 output");
    expect(response?.text).toContain("- **Context:** 0.0% of 128,000");
    expect(response?.text).toContain("- **Max tokens:** 8,192");
  });

  it("renders last-turn context usage from input tokens only", async () => {
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
                role: "assistant",
                content: [{ type: "text", text: "hi" }],
                createdAt: "2026-04-05T00:00:20.000Z",
                timestamp: Date.parse("2026-04-05T00:00:20.000Z"),
                api: "test",
                provider: "test",
                model: "stub",
                stopReason: "stop",
                usage: {
                  input: 11_000,
                  output: 50_000,
                  cacheRead: 20_000,
                  cacheWrite: 10_000,
                  totalTokens: 91_000,
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
        resolveModel: () =>
          ({
            id: "stub",
            name: "Stub",
            api: "test",
            provider: "test",
            baseUrl: "https://example.invalid",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          }) as never,
      }),
    });

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain("- **Context:** 8.6% of 128,000");
    expect(response?.text).not.toContain("71.1%");
  });

  it("renders unknown context usage when the context window is unavailable", async () => {
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
                role: "assistant",
                content: [{ type: "text", text: "hi" }],
                createdAt: "2026-04-05T00:00:20.000Z",
                timestamp: Date.parse("2026-04-05T00:00:20.000Z"),
                api: "test",
                provider: "test",
                model: "stub",
                stopReason: "stop",
                usage: {
                  input: 5,
                  output: 3,
                  cacheRead: 2,
                  cacheWrite: 1,
                  totalTokens: 11,
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
        resolveModel: () => undefined,
      }),
    });

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain("- **Context:** unknown of unknown");
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

    expect(response?.text).toContain("- **Tokens:** 0 total · 0 input · 0 output");
    expect(response?.text).toContain(["## Last LLM turn", "No LLM turn recorded yet."].join("\n"));
  });

  it("renders model limits without using the agent max output setting", async () => {
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
                role: "assistant",
                content: [{ type: "text", text: "hi" }],
                createdAt: "2026-04-05T00:00:20.000Z",
                timestamp: Date.parse("2026-04-05T00:00:20.000Z"),
                api: "test",
                provider: "test",
                model: "stub",
                stopReason: "stop",
                usage: {
                  input: 5,
                  output: 3,
                  cacheRead: 2,
                  cacheWrite: 1,
                  totalTokens: 11,
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
        agentRegistry: createAgentRegistry([
          {
            ...createDefaultAgent(),
            model: {
              ...createDefaultAgent().model,
              inference: { maxOutputTokens: 123 },
            },
          },
        ]),
        resolveModel: () =>
          ({
            id: "stub",
            name: "Stub",
            api: "test",
            provider: "test",
            baseUrl: "https://example.invalid",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 100000,
          }) as never,
      }),
    });

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain("- **Context:** 0.0% of 200,000");
    expect(response?.text).toContain("- **Max tokens:** 100,000");
    expect(response?.text).not.toContain("123");
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

    expect(response?.text).toContain("- **Working directory:** `/workspace/project`");
  });

  it("falls back to the agent home for the working directory", async () => {
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
            home: "/agents/default",
          },
          createDefaultAgent("ops"),
        ]),
      }),
    });

    const response = await statusCommandHandler.handle(context);

    expect(response?.text).toContain("- **Working directory:** `/agents/default`");
  });
});
