import type { Agent, AgentEvent, AgentMessage, AgentOptions } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, registerFauxProvider, type FauxProviderRegistration, type ImageContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import {
  createBuiltInToolRegistry,
  createPiAgentEngine,
  mergeShellPathEntries,
} from "./create-pi-agent-engine.js";
import { toAgentMessages } from "./message-mapping.js";

const registrations: FauxProviderRegistration[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (registrations.length > 0) {
    registrations.pop()?.unregister();
  }
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("createPiAgentEngine", () => {
  it("runs a real pi agent with persisted message context", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe(
          "You are concise.\n\n" +
            '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
            "Follow the workspace instructions.\n" +
            "</INSTRUCTIONS>",
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

    expect(result).toMatchObject({
      message: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        text: "You said hello.",
      },
      conversationEvents: [
        {
          kind: "message",
          id: "2:assistant",
          role: "assistant",
          content: [{ type: "text", text: "You said hello." }],
          correlationId: "corr-2",
        },
      ],
    });
  });

  it("reconstructs stored tool calls and tool results into the next model run", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.messages).toHaveLength(5);
        expect(context.messages[0]).toMatchObject({
          role: "user",
          content: "hello",
        });
        expect(context.messages[1]).toMatchObject({
          role: "assistant",
          content: [{ type: "text", text: "hi there" }],
        });
        expect(context.messages[2]).toMatchObject({
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "",
              thinkingSignature: expect.any(String),
            },
            {
              type: "text",
              text: "Checking the repo.",
            },
            {
              type: "toolCall",
              id: "tool-1",
              name: "read_file",
              arguments: {
                path: "README.md",
              },
            },
          ],
        });
        expect(context.messages[3]).toMatchObject({
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read_file",
          content: [{ type: "text", text: "README contents" }],
        });
        expect(context.messages[4]).toMatchObject({
          role: "user",
          content: [{ type: "text", text: "what did I just say?" }],
        });
        return fauxAssistantMessage("You said hello.");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async () => "unused context",
    });

    await engine.run({
      agent: createAgent(),
      conversation: {
        ...createConversation(),
        messages: [
          ...createConversation().messages,
          {
            kind: "message",
            id: "1:assistant:2",
            role: "assistant",
            createdAt: "2026-04-05T00:00:01.500Z",
            timestamp: Date.parse("2026-04-05T00:00:01.500Z"),
            api: "openai-responses",
            provider: "openai",
            model: "gpt-5-mini",
            responseId: "resp_1",
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
              {
                type: "thinking",
                thinking: "",
                thinkingSignature: JSON.stringify({
                  type: "reasoning",
                  id: "rs_1",
                  summary: [],
                  encrypted_content: "enc",
                }),
                redacted: true,
              },
              {
                type: "text",
                text: "Checking the repo.",
                textSignature: JSON.stringify({ v: 1, id: "msg_1", phase: "commentary" }),
              },
              {
                type: "toolCall",
                id: "tool-1",
                name: "read_file",
                arguments: {
                  path: "README.md",
                },
                thoughtSignature: "sig_1",
              },
            ],
          },
          {
            kind: "message",
            id: "1:tool-result:1",
            role: "toolResult",
            createdAt: "2026-04-05T00:00:01.800Z",
            timestamp: Date.parse("2026-04-05T00:00:01.800Z"),
            toolCallId: "tool-1",
            toolName: "read_file",
            content: [{ type: "text", text: "README contents" }],
            details: { path: "README.md" },
            isError: false,
          },
        ],
      },
      message: createIncomingMessage(),
    });
  });

  it("persists tool events emitted via agent subscriptions even when state.messages omits them", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("Final answer")]);

    const model = registration.getModel("faux-1");
    expect(model).toBeDefined();
    const resolvedModel = model!;

    const toolCallAssistantMessage = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Running ls." },
        {
          type: "toolCall" as const,
          id: "tool-1",
          name: "bash",
          arguments: { command: "ls" },
        },
      ],
      api: resolvedModel.api,
      provider: resolvedModel.provider,
      model: resolvedModel.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse" as const,
      timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
    };
    const toolResultMessage = {
      role: "toolResult" as const,
      toolCallId: "tool-1",
      toolName: "bash",
      content: [{ type: "text" as const, text: "file.txt" }],
      isError: false,
      timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
    };
    const finalAssistantMessage = fauxAssistantMessage("Final answer");

    const createAgentHandle = (_options: AgentOptions) => {
      void _options;
      return createAgentDouble({
        messages: [finalAssistantMessage],
        events: [
          { type: "message_end", message: toolCallAssistantMessage },
          { type: "message_end", message: toolResultMessage },
          { type: "message_end", message: finalAssistantMessage },
        ],
      });
    };

    const engine = createPiAgentEngine({
      createAgent: createAgentHandle,
      resolveModel: () => resolvedModel,
      readTextFile: async () => "unused context",
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(result.conversationEvents).toEqual([
      {
        kind: "message",
        id: "2:assistant:1",
        role: "assistant",
        createdAt: "2026-04-05T00:00:01.000Z",
        correlationId: "corr-2",
        timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
        api: resolvedModel.api,
        provider: resolvedModel.provider,
        model: resolvedModel.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Running ls." },
          {
            type: "toolCall",
            id: "tool-1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
      },
      {
        kind: "message",
        id: "2:tool-result:1",
        role: "toolResult",
        createdAt: "2026-04-05T00:00:02.000Z",
        correlationId: "corr-2",
        timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
        toolCallId: "tool-1",
        toolName: "bash",
        content: [{ type: "text", text: "file.txt" }],
        isError: false,
      },
      {
        kind: "message",
        id: "2:assistant:2",
        role: "assistant",
        content: [{ type: "text", text: "Final answer" }],
        createdAt: new Date(finalAssistantMessage.timestamp).toISOString(),
        correlationId: "corr-2",
        timestamp: finalAssistantMessage.timestamp,
        api: finalAssistantMessage.api,
        provider: finalAssistantMessage.provider,
        model: finalAssistantMessage.model,
        usage: finalAssistantMessage.usage,
        stopReason: finalAssistantMessage.stopReason,
      },
    ]);
  });

  it("falls back to state messages instead of collecting turn_end aggregate data", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("Final answer")]);

    const model = registration.getModel("faux-1");
    expect(model).toBeDefined();
    const resolvedModel = model!;

    const toolCallAssistantMessage = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Running ls." },
        {
          type: "toolCall" as const,
          id: "tool-1",
          name: "bash",
          arguments: { command: "ls" },
        },
      ],
      api: resolvedModel.api,
      provider: resolvedModel.provider,
      model: resolvedModel.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse" as const,
      timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
    };
    const toolResultMessage = {
      role: "toolResult" as const,
      toolCallId: "tool-1",
      toolName: "bash",
      content: [{ type: "text" as const, text: "file.txt" }],
      isError: false,
      timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
    };
    const staleTurnEndToolResultMessage = {
      ...toolResultMessage,
      content: [{ type: "text" as const, text: "ignored.txt" }],
    };
    const finalAssistantMessage = fauxAssistantMessage("Final answer");
    const conversation = createConversation();

    const createAgentHandle = (_options: AgentOptions) => {
      void _options;
      return createAgentDouble({
        messages: [
          ...toAgentMessages(conversation.messages, resolvedModel),
          toolCallAssistantMessage,
          toolResultMessage,
          finalAssistantMessage,
        ],
        events: [
          {
            type: "turn_end",
            message: toolCallAssistantMessage,
            toolResults: [staleTurnEndToolResultMessage],
          },
          {
            type: "turn_end",
            message: finalAssistantMessage,
            toolResults: [],
          },
        ],
      });
    };

    const engine = createPiAgentEngine({
      createAgent: createAgentHandle,
      resolveModel: () => resolvedModel,
      readTextFile: async () => "unused context",
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation,
      message: createIncomingMessage(),
    });

    expect(result.conversationEvents).toEqual([
      {
        kind: "message",
        id: "2:assistant:1",
        role: "assistant",
        createdAt: "2026-04-05T00:00:01.000Z",
        correlationId: "corr-2",
        timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
        api: resolvedModel.api,
        provider: resolvedModel.provider,
        model: resolvedModel.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Running ls." },
          {
            type: "toolCall",
            id: "tool-1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
      },
      {
        kind: "message",
        id: "2:tool-result:1",
        role: "toolResult",
        createdAt: "2026-04-05T00:00:02.000Z",
        correlationId: "corr-2",
        timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
        toolCallId: "tool-1",
        toolName: "bash",
        content: [{ type: "text", text: "file.txt" }],
        isError: false,
      },
      {
        kind: "message",
        id: "2:assistant:2",
        role: "assistant",
        content: [{ type: "text", text: "Final answer" }],
        createdAt: new Date(finalAssistantMessage.timestamp).toISOString(),
        correlationId: "corr-2",
        timestamp: finalAssistantMessage.timestamp,
        api: finalAssistantMessage.api,
        provider: finalAssistantMessage.provider,
        model: finalAssistantMessage.model,
        usage: finalAssistantMessage.usage,
        stopReason: finalAssistantMessage.stopReason,
      },
    ]);
  });

  it("fails clearly when the configured model cannot be resolved", async () => {
    const logger = createMockLogger();
    const engine = createPiAgentEngine({
      logger,
      resolveModel: () => undefined,
    });

    const runPromise = engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    await expect(runPromise).rejects.toThrow('Unknown model for agent "default": faux/faux-1');

    const runError = await runPromise.catch((error: unknown) => error);
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
      runError,
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

  it("marks transcribed voice messages in model input so the agent can clarify", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.messages).toHaveLength(3);
        expect(context.messages[0]).toMatchObject({
          role: "user",
        });
        expect(String(context.messages[0]?.content)).toContain(
          "Transcribed from a Telegram voice message",
        );
        expect(String(context.messages[0]?.content)).toContain(
          "ask a brief clarifying question",
        );
        expect(String(context.messages[0]?.content)).toContain(
          "hello",
        );
        return fauxAssistantMessage("I may need clarification.");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async () => "unused context",
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation: {
        ...createConversation(),
        messages: [
          {
            id: "voice-1",
            role: "user",
            content: "hello",
            timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
            createdAt: "2026-04-05T00:00:00.000Z",
            source: {
              kind: "telegram-voice-transcript",
              transcript: {
                provider: "openai",
                model: "gpt-4o-mini-transcribe",
              },
            },
          },
          {
            id: "voice-1:assistant",
            role: "assistant",
            content: [{ type: "text", text: "hi there" }],
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
            stopReason: "stop",
            createdAt: "2026-04-05T00:00:01.000Z",
          },
        ],
      },
      message: createIncomingMessage(),
    });

    expect(result.message.text).toBe("I may need clarification.");
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
        return createAgentDouble({ messages: [fauxAssistantMessage("stored response")] });
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
        return createAgentDouble({ messages: [fauxAssistantMessage("tool-ready")] });
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

  it("merges resolved MCP tools into the agent runtime and reuses them across runs", async () => {
    let capturedTools: Array<{ name: string }> | undefined;
    const close = vi.fn(async () => {});
    const mcpAgent = {
      ...createAgent(),
      tools: ["read"],
      mcp: {
        servers: [
          {
            id: "echo",
            command: process.execPath,
            args: ["echo"],
          },
        ],
      },
    };
    const resolveMcpTools = vi.fn(async () => ({
      tools: [
        {
          name: "echo__say",
          label: "say",
          description: "say something",
          parameters: Type.Object({ text: Type.String() }),
          async execute() {
            return {
              content: [{ type: "text" as const, text: "hi" }],
              details: {},
            };
          },
        },
      ],
      close,
    }));

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      resolveMcpTools,
      createAgent: (options) => {
        capturedTools = options.initialState?.tools as Array<{ name: string }>;
        return createAgentDouble({ messages: [fauxAssistantMessage("tool-ready")] });
      },
    });

    await engine.run({
      agent: mcpAgent,
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    await engine.run({
      agent: mcpAgent,
      conversation: createConversation(),
      message: {
        ...createIncomingMessage(),
        messageId: "3",
        correlationId: "corr-3",
      },
    });

    expect(capturedTools?.map((tool) => tool.name)).toEqual(["read", "echo__say"]);
    expect(resolveMcpTools).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    await engine.close?.();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes initialized MCP runtimes exactly once", async () => {
    const close = vi.fn(async () => {});
    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      resolveMcpTools: async () => ({
        tools: [],
        close,
      }),
      createAgent: () => createAgentDouble({ messages: [fauxAssistantMessage("ok")] }),
    });

    await engine.run({
      agent: {
        ...createAgent(),
        mcp: {
          servers: [
            {
              id: "echo",
              command: process.execPath,
              args: ["echo"],
            },
          ],
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    await engine.close?.();
    await engine.close?.();

    expect(close).toHaveBeenCalledTimes(1);
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
        return createAgentDouble({ messages: [fauxAssistantMessage("ok")] });
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

  it("runs agent engine lifecycle hooks around a run", async () => {
    const calls: string[] = [];
    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createAgent: () => createAgentDouble({ messages: [fauxAssistantMessage("ok")] }),
      agentEngineHooks: [
        {
          name: "test-hook",
          hooks: {
            onAgentEngineRunStart: ({ input }) => {
              calls.push(`start:${input.message.messageId}`);
            },
            onAgentEngineRunSuccess: ({ input, result, durationMs }) => {
              calls.push(`success:${input.message.messageId}:${result.message.text}:${durationMs >= 0}`);
            },
          },
        },
      ],
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).resolves.toMatchObject({
      message: {
        text: "ok",
      },
    });

    expect(calls).toEqual(["start:2", "success:2:ok:true"]);
  });

  it("runs agent engine error hooks without masking the original failure", async () => {
    const failure = new Error("model failed");
    const hookFailure = new Error("hook failed");
    const errorHook = vi.fn(async () => {
      throw hookFailure;
    });
    const logger = createMockLogger();
    const engine = createPiAgentEngine({
      logger,
      resolveModel: () => {
        throw failure;
      },
      agentEngineHooks: [
        {
          name: "test-hook",
          hooks: {
            onAgentEngineRunError: errorHook,
          },
        },
      ],
    });

    await expect(
      engine.run({
        agent: createAgent(),
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(failure);
    expect(errorHook).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          message: expect.objectContaining({ messageId: "2" }),
        }),
        error: failure,
        durationMs: expect.any(Number),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "plugin hook failed",
      expect.objectContaining({
        hookName: "onAgentEngineRunError",
        hookRegistrationName: "test-hook",
      }),
      hookFailure,
    );
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
        capturedWorkingDirectory =
          typeof workingDirectory === "string" ? workingDirectory : workingDirectory.get();
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
        return createAgentDouble({ messages: [fauxAssistantMessage("tool-ready")] });
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        workspace: {
          ...createAgent().workspace,
          cwd: "/workspace/project",
        },
        tools: ["read", "bash"],
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(capturedWorkingDirectory).toBe("/workspace/project");
    expect(capturedTools?.map((tool) => tool.name)).toEqual(["read", "bash"]);
  });

  it("allows agents to inspect and change their working directory via tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-working-directory-"));
    tempDirs.push(root);
    const firstDir = join(root, "first");
    const secondDir = join(root, "second");
    await mkdir(firstDir);
    await mkdir(secondDir);
    await writeFile(join(firstDir, "from-first.txt"), "first", "utf8");
    await writeFile(join(secondDir, "from-second.txt"), "second", "utf8");

    const registry = createBuiltInToolRegistry(firstDir);
    const getWorkingDirectory = registry.get("pwd");
    const setWorkingDirectory = registry.get("cd");
    const ls = registry.get("ls");

    expect(getWorkingDirectory).toBeDefined();
    expect(setWorkingDirectory).toBeDefined();
    expect(ls).toBeDefined();

    await expect(getWorkingDirectory!.execute("1", {})).resolves.toMatchObject({
      details: { workingDirectory: firstDir },
    });

    const firstListing = await ls!.execute("2", { path: "." });
    const firstListingText = firstListing.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");
    expect(firstListingText).toContain("from-first.txt");

    await expect(setWorkingDirectory!.execute("3", { path: secondDir })).resolves.toMatchObject({
      details: { workingDirectory: secondDir },
    });

    await expect(getWorkingDirectory!.execute("4", {})).resolves.toMatchObject({
      details: { workingDirectory: secondDir },
    });

    const secondListing = await ls!.execute("5", { path: "." });
    const secondListingText = secondListing.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");
    expect(secondListingText).toContain("from-second.txt");
  });

  it("prepends the agent shell PATH for bash tool execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-shell-path-"));
    tempDirs.push(root);

    const registry = createBuiltInToolRegistry(root, {
      ...createAgent(),
      workspace: {
        ...createAgent().workspace,
        shellPath: ["/custom/bin", "/usr/bin", "/bin"],
      },
    });
    const bash = registry.get("bash");

    expect(bash).toBeDefined();

    const result = await bash!.execute("1", {
      command: "printf '%s' \"$PATH\"",
    });
    const output = result.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");

    const outputEntries = output.split(":");

    expect(outputEntries.slice(0, 3)).toEqual(["/custom/bin", "/usr/bin", "/bin"]);
  });

  it("preserves the existing Windows PATH key and delimiter when merging shell path entries", () => {
    const env = {
      Path: "C:\\Windows\\System32;C:\\Program Files\\Git\\bin",
      PATHEXT: ".EXE;.CMD",
    };

    const merged = mergeShellPathEntries(env, ["C:\\project\\node_modules\\.bin"], {
      platform: "win32",
      delimiter: ";",
    });

    expect(merged.Path).toBe(
      "C:\\project\\node_modules\\.bin;C:\\Windows\\System32;C:\\Program Files\\Git\\bin",
    );
    expect(merged.PATH).toBeUndefined();
    expect(merged.PATHEXT).toBe(".EXE;.CMD");
  });

  it("removes duplicate Windows PATH keys before setting the merged path", () => {
    const env = {
      PATH: "C:\\stale\\bin",
      Path: "C:\\Windows\\System32",
      HOME: "C:\\Users\\thomas",
    };

    const merged = mergeShellPathEntries(env, ["C:\\project\\node_modules\\.bin"], {
      platform: "win32",
      delimiter: ";",
    });

    expect(merged).toEqual({
      Path: "C:\\project\\node_modules\\.bin;C:\\Windows\\System32",
      HOME: "C:\\Users\\thomas",
    });
  });

  it("deduplicates shell PATH entries while keeping configured entries first", () => {
    const env = {
      PATH: "/usr/bin:/bin",
    };

    const merged = mergeShellPathEntries(env, ["/custom/bin", "/usr/bin"], {
      platform: "linux",
      delimiter: ":",
    });

    expect(merged.PATH).toBe("/custom/bin:/usr/bin:/bin");
  });

  it("creates a POSIX PATH entry even when a differently cased key exists", () => {
    const env = {
      Path: "/wrapper/bin",
      HOME: "/tmp/home",
    };

    const merged = mergeShellPathEntries(env, ["/project/node_modules/.bin"], {
      platform: "linux",
      delimiter: ":",
    });

    expect(merged.PATH).toBe("/project/node_modules/.bin");
    expect(merged.Path).toBe("/wrapper/bin");
    expect(merged.HOME).toBe("/tmp/home");
  });

  it("rejects cd when the target is not a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-working-directory-"));
    tempDirs.push(root);
    const filePath = join(root, "file.txt");
    await writeFile(filePath, "hello", "utf8");

    const registry = createBuiltInToolRegistry(root);
    const setWorkingDirectory = registry.get("cd");

    await expect(setWorkingDirectory!.execute("1", { path: filePath })).rejects.toThrow(
      `Not a directory: ${filePath}`,
    );
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
        agent: {
          ...createAgent(),
          prompt: {
            ...createAgent().prompt,
            instructions: [{ file: "/workspace/RULES.md" }],
          },
        },
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'Failed to read instruction file for agent "default": /workspace/RULES.md (ENOENT)',
    );
  });

  it("appends AGENTS.md from the working directory after configured context files", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe(
          "You are concise.\n\n" +
            '<INSTRUCTIONS from="/workspace/RULES.md">\n\n' +
            "Follow the explicit rules.\n" +
            "</INSTRUCTIONS>\n\n" +
            '<INSTRUCTIONS from="/workspace/project/AGENTS.md">\n\n' +
            "Follow the workspace instructions.\n" +
            "</INSTRUCTIONS>",
        );
        return fauxAssistantMessage("ok");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async (path) => {
        if (path === "/workspace/RULES.md") {
          return "Follow the explicit rules.";
        }

        if (path === "/workspace/project/AGENTS.md") {
          return "Follow the workspace instructions.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        prompt: {
          ...createAgent().prompt,
          instructions: [{ file: "/workspace/RULES.md" }],
        },
        workspace: {
          cwd: "/workspace/project",
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });
  });

  it("separates context instruction blocks with blank lines", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toContain(
          'You are concise.\n\n<INSTRUCTIONS from="/workspace/RULES.md">\n\nFollow the explicit rules.\n</INSTRUCTIONS>\n\n<INSTRUCTIONS from="/workspace/project/AGENTS.md">\n\nFollow the workspace instructions.\n</INSTRUCTIONS>',
        );
        return fauxAssistantMessage("ok");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async (path) => {
        if (path === "/workspace/RULES.md") {
          return "Follow the explicit rules.";
        }

        if (path === "/workspace/project/AGENTS.md") {
          return "Follow the workspace instructions.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        prompt: {
          ...createAgent().prompt,
          instructions: [{ file: "/workspace/RULES.md" }],
        },
        workspace: {
          cwd: "/workspace/project",
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });
  });

  it("uses the persisted conversation working directory for auto-loaded AGENTS.md", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe(
          "You are concise.\n\n" +
            '<INSTRUCTIONS from="/workspace/next/AGENTS.md">\n\n' +
            "Follow the next workspace instructions.\n" +
            "</INSTRUCTIONS>",
        );
        return fauxAssistantMessage("ok");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async (path) => {
        if (path === "/workspace/next/AGENTS.md") {
          return "Follow the next workspace instructions.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        workspace: {
          cwd: "/workspace/start",
        },
      },
      conversation: {
        ...createConversation(),
        state: {
          ...createConversation().state,
          workingDirectory: "/workspace/next",
        },
      },
      message: createIncomingMessage(),
    });
  });

  it("skips an absent AGENTS.md in the working directory", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe("You are concise.");
        return fauxAssistantMessage("ok");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async (path) => {
        if (path === "/workspace/project/AGENTS.md") {
          throw new Error("ENOENT");
        }

        throw new Error(`unexpected path: ${path}`);
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        workspace: {
          cwd: "/workspace/project",
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });
  });

  it("does not duplicate AGENTS.md when it is already configured as an instruction file", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe(
          "You are concise.\n\n" +
            '<INSTRUCTIONS from="/workspace/project/AGENTS.md">\n\n' +
            "Follow the workspace instructions.\n" +
            "</INSTRUCTIONS>",
        );
        return fauxAssistantMessage("ok");
      },
    ]);

    const readTextFile = vi.fn(async (path: string) => {
      if (path === "/workspace/project/AGENTS.md") {
        return "Follow the workspace instructions.";
      }

      throw new Error(`unexpected path: ${path}`);
    });

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile,
      getContextFileFingerprint: async (path) => {
        if (path === "/workspace/project/AGENTS.md") {
          return "1:42";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    });

    await engine.run({
      agent: {
        ...createAgent(),
        prompt: {
          ...createAgent().prompt,
          instructions: [{ file: "/workspace/project/AGENTS.md" }],
        },
        workspace: {
          cwd: "/workspace/project",
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(readTextFile).toHaveBeenCalledTimes(1);
  });

  it("loads the base prompt from prompt.base.file when configured", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        expect(context.systemPrompt).toBe(
          "You are defined in a file.\n\n" +
            '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
            "Follow the workspace instructions.\n" +
            "</INSTRUCTIONS>",
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
        prompt: {
          ...createAgent().prompt,
          base: { file: "/workspace/prompts/default.md" },
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(result.message.text).toBe("ok");
  });

  it("fails clearly when the configured base prompt file cannot be read", async () => {
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
          prompt: {
            ...createAgent().prompt,
            base: { file: "/workspace/prompts/default.md" },
          },
        },
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'Failed to read base prompt for agent "default": /workspace/prompts/default.md (ENOENT)',
    );
  });

  it("fails clearly when the configured base prompt file is empty", async () => {
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
          prompt: {
            ...createAgent().prompt,
            base: { file: "/workspace/prompts/default.md" },
          },
        },
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow(
      'Configured base prompt file for agent "default" is empty: /workspace/prompts/default.md',
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
      createAgent: () => createAgentDouble({ messages: [fauxAssistantMessage("cached response")] }),
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

  it("invalidates the cached system prompt when stable template context changes", async () => {
    const readCalls: string[] = [];
    const systemPrompts: string[] = [];

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      promptTemplateSystemContext: {
        os: "Linux",
        platform: "linux",
        arch: "x64",
        hostname: "builder",
        username: "thomas",
        homeDir: "/home/thomas",
      },
      getContextFileFingerprint: async () => "mtime:1:size:100",
      readTextFile: async (path) => {
        readCalls.push(path);
        return "Bot {{bot.id}} in {{imp.dataRoot}}.";
      },
      createAgent: (options) => {
        systemPrompts.push(options.initialState?.systemPrompt ?? "");
        return createAgentDouble({ messages: [fauxAssistantMessage("response")] });
      },
    });

    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
      runtime: {
        configPath: "/etc/imp/config.json",
        dataRoot: "/var/lib/imp-a",
      },
    });
    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: {
        ...createIncomingMessage(),
        botId: "ops-telegram",
      },
      runtime: {
        configPath: "/etc/imp/config.json",
        dataRoot: "/var/lib/imp-b",
      },
    });

    expect(readCalls).toEqual([
      "/workspace/AGENTS.md",
      "/workspace/AGENTS.md",
    ]);
    expect(systemPrompts).toEqual([
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\nBot private-telegram in /var/lib/imp-a.\n</INSTRUCTIONS>',
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\nBot ops-telegram in /var/lib/imp-b.\n</INSTRUCTIONS>',
    ]);
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
        return createAgentDouble({ messages: [fauxAssistantMessage("response")] });
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
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\ncontext v1\n</INSTRUCTIONS>',
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\ncontext v2\n</INSTRUCTIONS>',
    ]);
  });

  it("fails clearly when an agent defines neither base prompt text nor file", async () => {
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
    });

    const agentWithoutPrompt: AgentDefinition = {
      ...createAgent(),
      prompt: {
        ...createAgent().prompt,
        base: {},
      },
    };

    await expect(
      engine.run({
        agent: agentWithoutPrompt,
        conversation: createConversation(),
        message: createIncomingMessage(),
      }),
    ).rejects.toThrow('Configured base prompt for agent "default" must define text or file.');
  });
});

type AgentDouble = Pick<Agent, "prompt" | "subscribe"> & {
  state: Pick<Agent["state"], "messages">;
};

interface AgentDoubleOptions {
  messages?: AgentMessage[];
  events?: AgentEvent[];
  onPrompt?: (
    input: AgentMessage | AgentMessage[] | string,
    images?: ImageContent[],
  ) => Promise<void> | void;
}

function createAgentDouble(options: AgentDoubleOptions = {}): AgentDouble {
  const subscribers: Array<Parameters<Agent["subscribe"]>[0]> = [];
  const messages = [...(options.messages ?? [])];

  async function prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async function prompt(input: string, images?: ImageContent[]): Promise<void>;
  async function prompt(
    input: AgentMessage | AgentMessage[] | string,
    images?: ImageContent[],
  ): Promise<void> {
    await options.onPrompt?.(input, images);

    const signal = new AbortController().signal;
    for (const event of options.events ?? []) {
      for (const subscriber of subscribers) {
        await subscriber(event, signal);
      }
    }
  }

  return {
    state: {
      messages,
    },
    prompt,
    subscribe(subscriber) {
      subscribers.push(subscriber);
      return () => {
        const index = subscribers.indexOf(subscriber);
        if (index >= 0) {
          subscribers.splice(index, 1);
        }
      };
    },
  };
}

function createAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    prompt: {
      base: {
        text: "You are concise.",
      },
      instructions: [{ file: "/workspace/AGENTS.md" }],
    },
    model: {
      provider: "faux",
      modelId: "faux-1",
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
        sessionId: "session-1",
      },
      agentId: "default",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
    },
    messages: [
      {
        id: "1",
        role: "user",
        content: "hello",
        timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        id: "1:assistant",
        role: "assistant",
        content: [{ type: "text", text: "hi there" }],
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
        stopReason: "stop",
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
