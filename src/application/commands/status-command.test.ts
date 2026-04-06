import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "../../agents/registry.js";
import { statusCommandHandler } from "./status-command.js";
import { createCommandContext, createDefaultAgent, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("statusCommandHandler", () => {
  it("renders active session state and history count", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("status"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: {
              conversation: { transport: "telegram", externalId: "42", sessionId: "session-1" },
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

  it("falls back to the agent workspace for the working directory", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("status"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => ({
            state: {
              conversation: { transport: "telegram", externalId: "42", sessionId: "session-1" },
              agentId: "default",
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:01:00.000Z",
              version: 1,
            },
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
