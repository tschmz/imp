import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationEvent } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { AgentEngine } from "../runtime/types.js";
import type { SkillSelector } from "../skills/selection.js";
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
      run: vi.fn(async ({ message }) => createAgentRunResult(message, "reply")),
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
      run: vi.fn(async ({ message }) => createAgentRunResult(message, "reply")),
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
      run: vi.fn(async ({ message }) => createAgentRunResult(message, "reply")),
    };
    const skillSelector: SkillSelector = {
      selectRelevantSkills: vi.fn(async ({ catalog }) => catalog.slice(0, 3)),
    };
    const logger = {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore: createConversationStore(),
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
      skillSelector,
      skillCatalog: [
        createSkill("git-commit", "Commit Git changes carefully."),
        createSkill("git-rebase", "Rebase a Git branch safely."),
        createSkill("git-review", "Review Git history and diffs."),
        createSkill("git-cleanup", "Clean up Git branches."),
      ],
      logger,
    });

    await service.handle(
      createIncomingMessage(
        "5",
        "Help me review git history, clean up the branch, commit the changes, and rebase safely.",
      ),
    );

    const runInput = vi.mocked(engine.run).mock.calls[0]?.[0];
    expect(runInput?.runtime?.activatedSkills).toHaveLength(3);
    expect(logger.info).toHaveBeenCalledWith(
      "resolved bot skills for turn",
      expect.objectContaining({
        skillCount: 3,
        skillNames: ["git-commit", "git-rebase", "git-review"],
      }),
    );
  });

  it("falls back to no activated skills when selection fails", async () => {
    const agent = createDefaultAgent();
    const engine: AgentEngine = {
      run: vi.fn(async ({ message }) => createAgentRunResult(message, "reply")),
    };
    const logger = {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    };
    const skillSelector: SkillSelector = {
      selectRelevantSkills: vi.fn(async () => {
        throw new Error("selection failed");
      }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore: createConversationStore(),
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
      skillSelector,
      skillCatalog: [createSkill("git-commit", "Commit Git changes carefully.")],
      logger,
    });

    await service.handle(createIncomingMessage("6", "Please help."));

    const runInput = vi.mocked(engine.run).mock.calls[0]?.[0];
    expect(runInput?.runtime).toEqual({
      configPath: "/tmp/config.json",
      dataRoot: "/tmp/data",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "failed to select bot skills; continuing without skill activation",
      expect.objectContaining({
        botId: "private-telegram",
        messageId: "6",
        agentId: "default",
      }),
      expect.any(Error),
    );
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
      run: vi.fn(async ({ message }) => createAgentRunResult(message, "reply")),
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
      kind: "message",
      role: "user",
      content: "transcribed text",
      source: {
        kind: "telegram-voice-transcript",
        transcript: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
    });
    expect(storedContext?.messages[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      content: [{ type: "text", text: "reply" }],
    });
  });

  it("persists tool call and tool result events from the agent run", async () => {
    const agent = createDefaultAgent();
    let storedContext:
      | {
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
      run: vi.fn(async ({ message }) => {
        const conversationEvents = [
          {
            kind: "message",
            id: `${message.messageId}:assistant:1`,
            role: "assistant",
            createdAt: "2026-04-05T00:00:01.000Z",
            correlationId: message.correlationId,
            timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
            api: "openai-responses",
            provider: "openai",
            model: "gpt-5-mini",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            content: [
              { type: "text", text: "Inspecting the repo." },
              {
                type: "toolCall",
                id: "tool-1",
                name: "read_file",
                arguments: {
                  path: "README.md",
                },
              },
            ],
          },
          {
            kind: "message",
            id: `${message.messageId}:tool-result:1`,
            role: "toolResult",
            createdAt: "2026-04-05T00:00:02.000Z",
            correlationId: message.correlationId,
            timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
            toolCallId: "tool-1",
            toolName: "read_file",
            content: [{ type: "text", text: "README contents" }],
            details: {
              path: "README.md",
            },
            isError: false,
          },
          {
            kind: "message",
            id: `${message.messageId}:assistant:2`,
            role: "assistant",
            content: [{ type: "text", text: "All set." }],
            createdAt: "2026-04-05T00:00:03.000Z",
            correlationId: message.correlationId,
            timestamp: Date.parse("2026-04-05T00:00:03.000Z"),
            api: "openai-responses",
            provider: "openai",
            model: "gpt-5-mini",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
          },
        ] satisfies ConversationEvent[];

        return {
          message: {
            conversation: message.conversation,
            text: "All set.",
          },
          conversationEvents,
        };
      }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore,
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
    });

    await service.handle(createIncomingMessage("7", "check the readme"));

    expect(storedContext?.messages).toMatchObject([
      {
        kind: "message",
        id: "7",
        role: "user",
        content: "check the readme",
      },
      {
        kind: "message",
        id: "7:assistant:1",
        role: "assistant",
        content: [
          { type: "text", text: "Inspecting the repo." },
          {
            type: "toolCall",
            id: "tool-1",
            name: "read_file",
            arguments: {
              path: "README.md",
            },
          },
        ],
      },
      {
        kind: "message",
        id: "7:tool-result:1",
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read_file",
        content: [{ type: "text", text: "README contents" }],
      },
      {
        kind: "message",
        id: "7:assistant:2",
        role: "assistant",
        content: [{ type: "text", text: "All set." }],
      },
    ]);
  });

  it("runs inbound message hooks around agent processing", async () => {
    const agent = createDefaultAgent();
    const calls: string[] = [];
    const engine: AgentEngine = {
      run: vi.fn(async ({ message }) => createAgentRunResult(message, "reply")),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore: createConversationStore(),
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
      inboundMessageHooks: [
        {
          name: "test-hook",
          hooks: {
            onInboundMessageStart: ({ message }) => {
              calls.push(`start:${message.messageId}`);
            },
            onInboundMessageSuccess: ({ message, response, durationMs }) => {
              calls.push(`success:${message.messageId}:${response.text}:${durationMs >= 0}`);
            },
          },
        },
      ],
    });

    await expect(service.handle(createIncomingMessage("8", "hello"))).resolves.toMatchObject({
      text: "reply",
    });

    expect(calls).toEqual(["start:8", "success:8:reply:true"]);
  });

  it("runs inbound message error hooks without masking the original failure", async () => {
    const agent = createDefaultAgent();
    const failure = new Error("engine failed");
    const hookFailure = new Error("hook failed");
    const errorHook = vi.fn(async () => {
      throw hookFailure;
    });
    const logger = {
      debug: vi.fn(async () => {}),
      info: vi.fn(async () => {}),
      error: vi.fn(async () => {}),
    };
    const engine: AgentEngine = {
      run: vi.fn(async () => {
        throw failure;
      }),
    };

    const service = createHandleIncomingMessage({
      agentRegistry: createAgentRegistry([agent]),
      conversationStore: createConversationStore(),
      engine,
      defaultAgentId: "default",
      runtimeInfo: createRuntimeInfo(),
      inboundMessageHooks: [
        {
          name: "test-hook",
          hooks: {
            onInboundMessageError: errorHook,
          },
        },
      ],
      logger,
    });

    await expect(service.handle(createIncomingMessage("9", "hello"))).rejects.toThrow(failure);
    expect(errorHook).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ messageId: "9" }),
        error: failure,
        durationMs: expect.any(Number),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "plugin hook failed",
      expect.objectContaining({
        hookName: "onInboundMessageError",
        hookRegistrationName: "test-hook",
      }),
      hookFailure,
    );
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
    references: [],
    scripts: [],
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

function createAgentRunResult(message: IncomingMessage, text: string) {
  return {
    message: {
      conversation: message.conversation,
      text,
    },
    conversationEvents: [
      {
        kind: "message" as const,
        id: `${message.messageId}:assistant`,
        role: "assistant" as const,
        content: [{ type: "text" as const, text }],
        timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
        api: "legacy",
        provider: "legacy",
        model: "legacy",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        createdAt: "2026-04-05T00:00:01.000Z",
        correlationId: message.correlationId,
      },
    ],
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
