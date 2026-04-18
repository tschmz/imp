import { describe, expect, it } from "vitest";
import type { ConversationStore } from "../../storage/types.js";
import { agentCommandHandler } from "./agent-command.js";
import {
  createCommandContext,
  createDependencies,
  createIncomingMessage,
} from "./test-helpers.js";

describe("agentCommandHandler", () => {
  it("switches the chat to the requested agent active session without mutating the prior session", async () => {
    const sessions = new Map([
      ["default", {
      state: {
        conversation: { transport: "telegram", externalId: "42", sessionId: "session-1" },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 1,
      },
      messages: [],
      }],
    ]);
    let selectedAgentId = "default";
    const store: ConversationStore = {
      get: async () => sessions.get(selectedAgentId),
      put: async () => {},
      listBackups: async () => [],
      restore: async () => false,
      ensureActive: async () => {
        throw new Error("legacy ensureActive should not be used");
      },
      create: async () => {
        throw new Error("legacy create should not be used");
      },
      getSelectedAgent: async () => selectedAgentId,
      setSelectedAgent: async (_ref, agentId) => {
        selectedAgentId = agentId;
      },
      getActiveForAgent: async (agentId) => sessions.get(agentId),
      listBackupsForAgent: async () => [],
      restoreForAgent: async () => false,
      ensureActiveForAgent: async (ref, options) => {
        selectedAgentId = options.agentId;
        const existing = sessions.get(options.agentId);
        if (existing) {
          return existing;
        }

        const created = {
          state: {
            conversation: { ...ref, sessionId: "session-2" },
            agentId: options.agentId,
            createdAt: options.now,
            updatedAt: options.now,
            version: 1,
          },
          messages: [],
        };
        sessions.set(options.agentId, created);
        return created;
      },
      createForAgent: async () => {
        throw new Error("createForAgent should not be used");
      },
    };
    const context = createCommandContext({
      message: createIncomingMessage("agent", "ops"),
      dependencies: createDependencies({ conversationStore: store }),
    });

    const response = await agentCommandHandler.handle(context);

    expect(agentCommandHandler.canHandle("agent")).toBe(true);
    expect(response?.text).toContain('Switched this chat to agent "ops".');
    expect(sessions.get("default")?.state.agentId).toBe("default");
    expect(await store.getSelectedAgent!(context.message.conversation)).toBe("ops");
    expect((await store.get(context.message.conversation))?.state.conversation.sessionId).toBe("session-2");
  });
});
