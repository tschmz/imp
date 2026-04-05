import { fauxAssistantMessage, registerFauxProvider, type FauxProviderRegistration } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import { createPiAgentEngine } from "./create-pi-agent-engine.js";

const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
  while (registrations.length > 0) {
    registrations.pop()?.unregister();
  }
});

describe("createPiAgentEngine", () => {
  it("runs a real pi agent with persisted transcript context", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe(
          "You are concise.\n\n" +
            "[Context File: /workspace/AGENTS.md]\n" +
            "Follow the workspace instructions.",
        );
        expect(context.messages).toHaveLength(3);
        expect(context.messages[0]).toMatchObject({
          role: "user",
          content: "hello",
        });
        expect(context.messages[1]).toMatchObject({
          role: "assistant",
          content: [{ type: "text", text: "hi there" }],
        });
        expect(context.messages[2]).toMatchObject({
          role: "user",
          content: [{ type: "text", text: "what did I just say?" }],
        });
        return fauxAssistantMessage("You said hello.");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: (provider, modelId) => {
        if (provider !== "faux" || modelId !== "faux-1") {
          return undefined;
        }

        return registration.getModel("faux-1");
      },
      readTextFile: async (path) => {
        expect(path).toBe("/workspace/AGENTS.md");
        return "Follow the workspace instructions.";
      },
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(result).toEqual({
      message: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        text: "You said hello.",
      },
    });
  });

  it("fails clearly when the configured model cannot be resolved", async () => {
    const logger = createMockLogger();
    const engine = createPiAgentEngine({
      logger,
      resolveModel: () => undefined,
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow('Unknown model for agent "default": faux/faux-1');
    expect(logger.error).toHaveBeenCalledWith(
      "agent engine run failed",
      expect.objectContaining({
        botId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "2",
        correlationId: "corr-2",
        agentId: "default",
        durationMs: expect.any(Number),
        errorType: "Error",
      }),
      expect.any(Error),
    );
  });

  it("fails clearly when the assistant response contains no text", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([fauxAssistantMessage([])]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async () => "unused context",
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'Agent "default" produced an assistant message without text content.',
    );
  });

  it("surfaces upstream agent errors instead of masking them as empty text", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "No API key for provider: faux",
      }),
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async () => "unused context",
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow('Agent "default" failed: No API key for provider: faux');
  });

  it("applies inference options and request overrides from agent config", async () => {
    let capturedOnPayload:
      | ((payload: unknown, model: { api: string }) => unknown | Promise<unknown> | undefined)
      | undefined;

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createAgent: (options) => {
        capturedOnPayload = options.onPayload as typeof capturedOnPayload;
        return {
          state: {
            messages: [fauxAssistantMessage("stored response")],
          },
          prompt: async () => {},
        };
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        inference: {
          maxOutputTokens: 2000,
          metadata: {
            app: "imp",
            env: "test",
          },
          request: {
            store: true,
            service_tier: "priority",
          },
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(capturedOnPayload).toBeTypeOf("function");
    expect(
      await capturedOnPayload?.(
        {
          model: "gpt-5.4",
          store: false,
          max_output_tokens: 4000,
          metadata: {
            existing: true,
          },
        },
        { api: "openai-responses" },
      ),
    ).toEqual({
      model: "gpt-5.4",
      store: true,
      max_output_tokens: 2000,
      metadata: {
        app: "imp",
        env: "test",
      },
      service_tier: "priority",
    });
  });

  it("passes resolved configured tools into the agent runtime", async () => {
    let capturedTools: unknown[] | undefined;
    const tool = {
      name: "read_file",
      label: "Read File",
      description: "Read a file from disk.",
      parameters: Type.Object({ path: Type.String() }),
      async execute() {
        return {
          content: [{ type: "text" as const, text: "ok" }],
          details: {},
        };
      },
    };

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      toolRegistry: {
        list: () => [tool],
        get: (name) => (name === "read_file" ? tool : undefined),
        pick: (names) => names.flatMap((name) => (name === "read_file" ? [tool] : [])),
      },
      createAgent: (options) => {
        capturedTools = options.initialState?.tools as unknown[];
        return {
          state: {
            messages: [fauxAssistantMessage("tool-ready")],
          },
          prompt: async () => {},
        };
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        tools: ["read_file"],
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(capturedTools).toEqual([tool]);
  });

  it("passes a dynamic api key resolver into the agent runtime", async () => {
    let capturedGetApiKey:
      | ((provider: string) => Promise<string | undefined> | string | undefined)
      | undefined;

    const engine = createPiAgentEngine({
      getApiKey: async (provider, agent) =>
        provider === "openai-codex" && agent.authFile === "/workspace/auth.json"
          ? "oauth-token"
          : undefined,
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createAgent: (options) => {
        capturedGetApiKey = options.getApiKey;
        return {
          state: {
            messages: [fauxAssistantMessage("ok")],
          },
          prompt: async () => {},
        };
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        authFile: "/workspace/auth.json",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(capturedGetApiKey).toBeTypeOf("function");
    await expect(capturedGetApiKey?.("openai-codex")).resolves.toBe("oauth-token");
    await expect(capturedGetApiKey?.("openai")).resolves.toBeUndefined();
  });

  it("registers built-in tools in the default runtime path", async () => {
    let capturedTools: Array<{ name: string }> | undefined;
    let capturedWorkingDirectory: string | undefined;

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createBuiltInToolRegistry: (workingDirectory) => {
        capturedWorkingDirectory = workingDirectory;
        return {
          list: () => [],
          get: () => undefined,
          pick: (names) =>
            names.map((name) => ({
              name,
              label: name,
              description: `${name} tool`,
              parameters: Type.Object({}),
              async execute() {
                return {
                  content: [],
                  details: {},
                };
              },
            })),
        };
      },
      createAgent: (options) => {
        capturedTools = options.initialState?.tools as Array<{ name: string }>;
        return {
          state: {
            messages: [fauxAssistantMessage("tool-ready")],
          },
          prompt: async () => {},
        };
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        context: {
          ...createAgent().context,
          workingDirectory: "/workspace/project",
        },
        tools: ["read", "bash"],
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(capturedWorkingDirectory).toBe("/workspace/project");
    expect(capturedTools?.map((tool) => tool.name)).toEqual(["read", "bash"]);
  });

  it("fails clearly when a configured tool cannot be resolved", async () => {
    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      toolRegistry: {
        list: () => [],
        get: () => undefined,
        pick: () => [],
      },
    });

    await expect(
      engine.run({
        agent: {
          ...createAgent(),
          tools: ["read"],
        },
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow('Unknown tools for agent "default": read');
  });

  it("fails clearly when a configured context file cannot be read", async () => {
    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      createAgent: () => {
        throw new Error("createAgent should not be called when context loading fails");
      },
      readTextFile: async () => {
        throw new Error("ENOENT");
      },
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'Failed to read context file for agent "default": /workspace/AGENTS.md (ENOENT)',
    );
  });

  it("loads the system prompt from systemPromptFile when configured", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe(
          "You are defined in a file.\n\n" +
            "[Context File: /workspace/AGENTS.md]\n" +
            "Follow the workspace instructions.",
        );
        return fauxAssistantMessage("ok");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async (path) => {
        if (path === "/workspace/prompts/default.md") {
          return "You are defined in a file.";
        }

        if (path === "/workspace/AGENTS.md") {
          return "Follow the workspace instructions.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    });

    const result = await engine.run({
      agent: {
        ...createAgent(),
        systemPrompt: "",
        systemPromptFile: "/workspace/prompts/default.md",
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(result.message.text).toBe("ok");
  });

  it("fails clearly when the configured system prompt file cannot be read", async () => {
    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      createAgent: () => {
        throw new Error("createAgent should not be called when prompt loading fails");
      },
      readTextFile: async (path) => {
        if (path === "/workspace/prompts/default.md") {
          throw new Error("ENOENT");
        }

        return "unused";
      },
    });

    await expect(
      engine.run({
        agent: {
          ...createAgent(),
          systemPrompt: "",
          systemPromptFile: "/workspace/prompts/default.md",
        },
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'Failed to read system prompt file for agent "default": /workspace/prompts/default.md (ENOENT)',
    );
  });

  it("fails clearly when the configured system prompt file is empty", async () => {
    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      createAgent: () => {
        throw new Error("createAgent should not be called when prompt loading fails");
      },
      readTextFile: async (path) => {
        if (path === "/workspace/prompts/default.md") {
          return "   \n\n  ";
        }

        return "unused";
      },
    });

    await expect(
      engine.run({
        agent: {
          ...createAgent(),
          systemPrompt: "",
          systemPromptFile: "/workspace/prompts/default.md",
        },
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'System prompt file for agent "default" is empty: /workspace/prompts/default.md',
    );
  });

  it("reuses the cached system prompt when context file fingerprints are unchanged", async () => {
    const readCalls: string[] = [];
    const fingerprintCalls: string[] = [];

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      getContextFileFingerprint: async (path) => {
        fingerprintCalls.push(path);
        return "mtime:1:size:100";
      },
      readTextFile: async (path) => {
        readCalls.push(path);
        return "cached context";
      },
      createAgent: () => ({
        state: {
          messages: [fauxAssistantMessage("cached response")],
        },
        prompt: async () => {},
      }),
    });

    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });
    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(fingerprintCalls).toEqual([
      "/workspace/AGENTS.md",
      "/workspace/AGENTS.md",
    ]);
    expect(readCalls).toEqual(["/workspace/AGENTS.md"]);
  });

  it("invalidates the cached system prompt when context fingerprints change", async () => {
    const readCalls: string[] = [];
    const contextByFingerprint = new Map([
      ["mtime:1:size:100", "context v1"],
      ["mtime:2:size:100", "context v2"],
    ]);
    const fingerprints = ["mtime:1:size:100", "mtime:2:size:100"];
    const systemPrompts: string[] = [];

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      getContextFileFingerprint: async () => fingerprints.shift() ?? "mtime:2:size:100",
      readTextFile: async (path) => {
        const currentFingerprint = readCalls.length === 0 ? "mtime:1:size:100" : "mtime:2:size:100";
        readCalls.push(path);
        return contextByFingerprint.get(currentFingerprint) ?? "unknown context";
      },
      createAgent: (options) => {
        systemPrompts.push(options.initialState?.systemPrompt ?? "");
        return {
          state: {
            messages: [fauxAssistantMessage("response")],
          },
          prompt: async () => {},
        };
      },
    });

    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });
    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(readCalls).toEqual([
      "/workspace/AGENTS.md",
      "/workspace/AGENTS.md",
    ]);
    expect(systemPrompts).toEqual([
      "You are concise.\n\n[Context File: /workspace/AGENTS.md]\ncontext v1",
      "You are concise.\n\n[Context File: /workspace/AGENTS.md]\ncontext v2",
    ]);
  });
});

function createAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    systemPrompt: "You are concise.",
    model: {
      provider: "faux",
      modelId: "faux-1",
    },
    context: {
      files: ["/workspace/AGENTS.md"],
    },
    tools: [],
    extensions: [],
  };
}

function createConversation(): ConversationContext {
  return {
    state: {
      conversation: {
        transport: "telegram",
        externalId: "42",
      },
      agentId: "default",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
    },
    messages: [
      {
        id: "1",
        role: "user",
        text: "hello",
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        id: "1:assistant",
        role: "assistant",
        text: "hi there",
        createdAt: "2026-04-05T00:00:01.000Z",
      },
    ],
  };
}

function createIncomingMessage(): IncomingMessage {
  return {
    botId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId: "2",
    correlationId: "corr-2",
    userId: "7",
    text: "what did I just say?",
    receivedAt: "2026-04-05T00:00:02.000Z",
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(async () => {}),
    info: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
  };
}
