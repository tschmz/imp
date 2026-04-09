import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { IncomingMessage } from "../domain/message.js";
import type { AgentEngine } from "../runtime/types.js";
import type { ConversationStore } from "../storage/types.js";
import { createHandleIncomingMessage } from "./handle-incoming-message.js";

describe("createHandleIncomingMessage", () => {
  it("routes known inbound commands to the command registry", async () => {
    const agent = createDefaultAgent();
    const conversationStore: ConversationStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
      create: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
    };

    const engine: AgentEngine = {
      run: vi.fn(async () => {
        throw new Error("engine should not run for /help");
      }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const response = await service.handle(createIncomingMessage("1", "/help", "help"));

    expect(response.text).toContain("Available commands:");
    expect(engine.run).not.toHaveBeenCalled();
  });

  it("falls back to normal agent processing when no command handler matches", async () => {
    const agent = createDefaultAgent();
    const byConversation = new Map<string, Awaited<ReturnType<ConversationStore["get"]>>>();

    const conversationStore: ConversationStore = {
      get: vi.fn(async (ref) =>
        "sessionId" in ref
          ? byConversation.get(`${ref.externalId}:${ref.sessionId}`)
          : [...byConversation.values()][0],
      ),
      put: vi.fn(async (context) => {
        byConversation.set(
          `${context.state.conversation.externalId}:${context.state.conversation.sessionId}`,
          context,
        );
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async (ref, options) => {
        const existing = [...byConversation.values()][0];
        if (existing) {
          return existing;
        }

        const context = {
          state: {
            conversation: {
              ...ref,
              sessionId: "session-1",
            },
            agentId: options.agentId,
            createdAt: options.now,
            updatedAt: options.now,
            version: 1,
          },
          messages: [],
        };
        byConversation.set(`${ref.externalId}:session-1`, context);
        return context;
      }),
      create: vi.fn(async (ref, options) => {
        const context = {
          state: {
            conversation: {
              ...ref,
              sessionId: "session-1",
            },
            agentId: options.agentId,
            createdAt: options.now,
            updatedAt: options.now,
            version: 1,
          },
          messages: [],
        };
        byConversation.set(`${ref.externalId}:session-1`, context);
        return context;
      }),
    };

    const engine: AgentEngine = {
      run: vi.fn(async ({ message }) => ({
        message: {
          conversation: message.conversation,
          text: "reply",
        },
      })),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    const response = await service.handle(createIncomingMessage("2", "/unknown", undefined));

    expect(response.text).toBe("reply");
    expect(engine.run).toHaveBeenCalledTimes(1);
    expect(engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: {
          configPath: "/tmp/config.json",
          dataRoot: "/tmp/data",
        },
      }),
    );
  });

  it("does not change runtime context when no skill catalog is configured", async () => {
    const agent = createDefaultAgent();
    const engine: AgentEngine = {
      run: vi.fn(async ({ message }) => ({
        message: {
          conversation: message.conversation,
          text: "reply",
        },
      })),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore: createConversationStore(),
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    await service.handle(createIncomingMessage("4", "plain text"));

    const runInput = vi.mocked(engine.run).mock.calls[0]?.[0];
    expect(runInput?.runtime).toEqual({
      configPath: "/tmp/config.json",
      dataRoot: "/tmp/data",
    });
  });

  it("activates at most three relevant skills", async () => {
    const agent = createDefaultAgent();
    const engine: AgentEngine = {
      run: vi.fn(async ({ message }) => ({
        message: {
          conversation: message.conversation,
          text: "reply",
        },
      })),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore: createConversationStore(),
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
      skillCatalog: [
        createSkill("git-commit", "Commit Git changes carefully."),
        createSkill("git-rebase", "Rebase a Git branch safely."),
        createSkill("git-review", "Review Git history and diffs."),
        createSkill("git-cleanup", "Clean up Git branches."),
      ],
    });

    await service.handle(
      createIncomingMessage(
        "5",
        "Help me review git history, clean up the branch, commit the changes, and rebase safely.",
      ),
    );

    const runInput = vi.mocked(engine.run).mock.calls[0]?.[0];
    expect(runInput?.runtime?.activatedSkills).toHaveLength(3);
  });

  it("persists the user message source in conversation history", async () => {
    const agent = createDefaultAgent();
    let storedContext:
      | {
          state: {
            conversation: { transport: string; externalId: string; sessionId: string };
            agentId: string;
            createdAt: string;
            updatedAt: string;
            version: number;
          };
          messages: Array<Record<string, unknown>>;
        }
      | undefined;

    const conversationStore: ConversationStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async (context) => {
        storedContext = context as typeof storedContext;
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
      create: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
    };

    const engine: AgentEngine = {
      run: vi.fn(async ({ message }) => ({
        message: {
          conversation: message.conversation,
          text: "reply",
        },
      })),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    await service.handle({
      ...createIncomingMessage("3", "transcribed text"),
      source: {
        kind: "telegram-voice-transcript",
        transcript: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
    });

    expect(storedContext?.messages[0]).toMatchObject({
      role: "user",
      text: "transcribed text",
      source: {
        kind: "telegram-voice-transcript",
        transcript: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
    });
  });

  it("fails when the default agent cannot be resolved", () => {
    expect(() =>
      createHandleIncomingMessage({
        agentRegistry: createAgentRegistry([]),
        conversationStore: {
          get: vi.fn(),
          put: vi.fn(),
          listBackups: vi.fn(),
          restore: vi.fn(),
          ensureActive: vi.fn(),
          create: vi.fn(),
        },
        engine: {
          run: vi.fn(),
        },
        defaultAgentId: "missing",
        runtimeInfo: createRuntimeInfo(),
      }),
    ).toThrow("Unknown default agent: missing");
  });
});

function createDefaultAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    prompt: {
      base: {
        text: "You are concise.",
      },
    },
    model: {
      provider: "test",
      modelId: "stub",
    },
    tools: [],
    extensions: [],
  };
}

function createSkill(name: string, description: string) {
  return {
    name,
    description,
    directoryPath: `/skills/${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    body: `\n${description}`,
    content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}`,
  };
}

function createRuntimeInfo() {
  return {
    botId: "private-telegram",
    configPath: "/tmp/config.json",
    dataRoot: "/tmp/data",
    logFilePath: "/tmp/private-telegram.log",
    loggingLevel: "info" as const,
    activeBotIds: ["private-telegram", "ops-telegram"],
  };
}

function createConversationStore(): ConversationStore {
  return {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => {}),
    listBackups: vi.fn(async () => []),
    restore: vi.fn(async () => false),
    ensureActive: vi.fn(async (ref, options) => ({
      state: {
        conversation: {
          ...ref,
          sessionId: "session-1",
        },
        agentId: options.agentId,
        createdAt: options.now,
        updatedAt: options.now,
        version: 1,
      },
      messages: [],
    })),
    create: vi.fn(async (ref, options) => ({
      state: {
        conversation: {
          ...ref,
          sessionId: "session-1",
        },
        agentId: options.agentId,
        createdAt: options.now,
        updatedAt: options.now,
        version: 1,
      },
      messages: [],
    })),
  };
}

function createIncomingMessage(
  messageId: string,
  text: string,
  command?: IncomingMessage["command"],
  commandArgs?: string,
): IncomingMessage {
  return {
    botId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId,
    correlationId: `corr-${messageId}`,
    userId: "7",
    text,
    receivedAt: "2026-04-05T00:00:00.000Z",
    source: {
      kind: "text",
    },
    ...(command ? { command } : {}),
    ...(commandArgs ? { commandArgs } : {}),
  };
}
