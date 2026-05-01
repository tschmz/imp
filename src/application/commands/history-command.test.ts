import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "../../agents/registry.js";
import { historyCommandHandler } from "./history-command.js";
import { createCommandContext, createDefaultAgent, createDependencies, createIncomingMessage } from "./test-helpers.js";

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
            messages: [{ id: "m1", role: "user", content: "hi", timestamp: Date.parse("2026-04-05T00:04:00.000Z"), createdAt: "2026-04-05T00:04:00.000Z" }],
          }),
          put: async () => {},
          listBackups: async () => [
            {
              id: "session-1",
              sessionId: "session-1",
              title: "Earlier investigation",
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
    expect(response?.text).toContain("**History**");
    expect(response?.text).toContain("Current: Current work · `default` · 1 turn · 1 event");
    expect(response?.text).toContain("Working dir: not set");
    expect(response?.text).toContain("1. Earlier investigation · `ops` · 2 events · updated ");
  });

  it("falls back to an untitled label for previous sessions without a title", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("history"),
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

    expect(response?.text).toContain(["**History**", "Current: none"].join("\n"));
    expect(response?.text).toContain("1. untitled · `ops` · 2 events · updated ");
  });

  it("falls back to the agent workspace for the active session working directory", async () => {
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
            messages: [{ id: "m1", role: "user", content: "hi", timestamp: Date.parse("2026-04-05T00:04:00.000Z"), createdAt: "2026-04-05T00:04:00.000Z" }],
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

    const response = await historyCommandHandler.handle(context);

    expect(response?.text).toContain("Working dir: `/workspace/project`");
    expect(response?.text).toContain("Previous:");
    expect(response?.text).toContain("No previous sessions.");
  });

  it("falls back to the agent home for the active session working directory", async () => {
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
            messages: [{ id: "m1", role: "user", content: "hi", timestamp: Date.parse("2026-04-05T00:04:00.000Z"), createdAt: "2026-04-05T00:04:00.000Z" }],
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

    const response = await historyCommandHandler.handle(context);

    expect(response?.text).toContain("Working dir: `/agents/default`");
    expect(response?.text).toContain("Previous:");
    expect(response?.text).toContain("No previous sessions.");
  });
});
