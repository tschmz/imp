import type { Agent, AgentEvent, AgentMessage, AgentOptions } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, registerFauxProvider, type FauxProviderRegistration, type ImageContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext, ConversationEvent } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import { UserVisibleProcessingError } from "../domain/processing-error.js";
import type { Logger } from "../logging/types.js";
import type { ToolDefinition } from "../tools/types.js";
import {
  createBuiltInToolRegistry,
  createPiAgentEngine,
  mergeShellPathEntries,
} from "./create-pi-agent-engine.js";
import {
  createInlineBasePrompt,
  expectSystemPrompt,
  renderSystemPromptForTest,
} from "./prompt-test-helpers.js";
import { createLoadSkillTool } from "./tool-resolution.js";
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
        expectSystemPrompt(context.systemPrompt, {
          base: "You are concise.",
          instructions: [
            {
              source: "/workspace/AGENTS.md",
              content: "Follow the workspace instructions.",
            },
          ],
        });
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
          id: "2:assistant:1",
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

    const streamedEvents: ConversationEvent[][] = [];
    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
      onConversationEvents: async (events) => {
        streamedEvents.push(events);
      },
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
    expect(streamedEvents).toEqual(result.conversationEvents.map((event) => [event]));
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
    const initialMessages = await toAgentMessages(conversation.messages, resolvedModel);

    const createAgentHandle = (_options: AgentOptions) => {
      void _options;
      return createAgentDouble({
        messages: [
          ...initialMessages,
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

  it("continues from persisted user or tool context without adding a new prompt", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("Recovered answer")]);
    const resolvedModel = registration.getModel("faux-1")!;
    const finalAssistantMessage = fauxAssistantMessage("Recovered answer");
    const onPrompt = vi.fn();
    const onContinue = vi.fn();

    const engine = createPiAgentEngine({
      createAgent: () => createAgentDouble({
        messages: [finalAssistantMessage],
        events: [{ type: "message_end", message: finalAssistantMessage }],
        onPrompt,
        onContinue,
      }),
      resolveModel: () => resolvedModel,
      readTextFile: async () => "unused context",
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
      continueFromContext: true,
    });

    expect(onPrompt).not.toHaveBeenCalled();
    expect(onContinue).toHaveBeenCalledOnce();
    expect(result.message.text).toBe("Recovered answer");
    expect(result.conversationEvents).toMatchObject([
      {
        id: "2:assistant:1",
        role: "assistant",
        content: [{ type: "text", text: "Recovered answer" }],
      },
    ]);
  });

  it("continues assistant indexes after persisted tool results", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("Recovered answer")]);
    const resolvedModel = registration.getModel("faux-1")!;
    const finalAssistantMessage = fauxAssistantMessage("Recovered answer");
    const conversation: ConversationContext = {
      ...createConversation(),
      messages: [
        ...createConversation().messages,
        {
          id: "2:assistant:1",
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tool-1",
              name: "read_file",
              arguments: { path: "README.md" },
            },
          ],
          timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "toolUse",
          createdAt: "2026-04-05T00:00:02.000Z",
        },
        {
          id: "2:tool-result:1",
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read_file",
          content: [{ type: "text", text: "README" }],
          isError: false,
          timestamp: Date.parse("2026-04-05T00:00:03.000Z"),
          createdAt: "2026-04-05T00:00:03.000Z",
        },
      ],
    };

    const engine = createPiAgentEngine({
      createAgent: () => createAgentDouble({
        messages: [finalAssistantMessage],
        events: [{ type: "message_end", message: finalAssistantMessage }],
        onContinue: vi.fn(),
      }),
      resolveModel: () => resolvedModel,
      readTextFile: async () => "unused context",
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation,
      message: createIncomingMessage(),
      continueFromContext: true,
    });

    expect(result.conversationEvents).toMatchObject([
      {
        id: "2:assistant:2",
        role: "assistant",
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
        endpointId: "private-telegram",
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

  it("allows an empty assistant response for no-reply channels", async () => {
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

    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
      runtime: {
        replyChannel: {
          kind: "none",
          delivery: "none",
        },
      },
    });

    expect(result.message.text).toBe("");
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
            id: "voice-1:assistant:1",
            role: "assistant",
            content: [{ type: "text", text: "hi there" }],
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
            stopReason: "stop",
            createdAt: "2026-04-05T00:00:01.000Z",
          },
        ],
      },
      message: createIncomingMessage(),
    });

    expect(result.message.text).toBe("I may need clarification.");
  });

  it("includes telegram document context in the current model prompt", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      (context) => {
        const current = context.messages.at(-1);
        const currentContent =
          typeof current?.content === "string" ? current.content : JSON.stringify(current?.content);
        expect(current).toMatchObject({
          role: "user",
        });
        expect(currentContent).toContain("Telegram document uploaded");
        expect(currentContent).toContain("Saved path: /var/lib/imp/report.txt");
        expect(currentContent).toContain("File name: report.txt");
        expect(currentContent).toContain("Please inspect this report");
        return fauxAssistantMessage("I can inspect the saved file.");
      },
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async () => "unused context",
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: {
        ...createIncomingMessage(),
        text: "Please inspect this report",
        source: {
          kind: "telegram-document",
          document: {
            fileId: "doc-file",
            fileName: "report.txt",
            mimeType: "text/plain",
            sizeBytes: 13,
            savedPath: "/var/lib/imp/report.txt",
          },
        },
      },
    });

    expect(result.message.text).toBe("I can inspect the saved file.");
  });

  it("passes current-turn telegram images to vision-capable models", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-engine-image-"));
    tempDirs.push(root);
    const imagePath = join(root, "current-image.png");
    await writeFile(imagePath, "png-bytes", "utf8");
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-vision", name: "Faux Vision", input: ["text", "image"] }],
    });
    registrations.push(registration);
    const onPrompt = vi.fn();

    const engine = createPiAgentEngine({
      createAgent: () => createAgentDouble({
        messages: [fauxAssistantMessage("Looks like an image.")],
        events: [{ type: "message_end", message: fauxAssistantMessage("Looks like an image.") }],
        onPrompt,
      }),
      resolveModel: () => registration.getModel("faux-vision"),
      readTextFile: async () => "unused context",
    });

    const result = await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: {
        ...createIncomingMessage(),
        text: "Describe this image",
        source: {
          kind: "telegram-image",
          image: {
            fileId: "img-file",
            fileName: "current-image.png",
            mimeType: "image/png",
            savedPath: imagePath,
            telegramType: "photo",
          },
        },
      },
    });

    expect(result.message.text).toBe("Looks like an image.");
    expect(onPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Telegram image uploaded"),
      [
        {
          type: "image",
          data: Buffer.from("png-bytes").toString("base64"),
          mimeType: "image/png",
        },
      ],
    );
  });

  it("surfaces upstream agent errors instead of masking them as empty text", async () => {
    const logger = createMockLogger();
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);
    registration.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "No API key for provider: faux",
        responseId: "resp-1",
      }),
    ]);

    const engine = createPiAgentEngine({
      logger,
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async () => "unused context",
    });

    const runPromise = engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    await expect(runPromise).rejects.toThrow('Agent "default" failed: No API key for provider: faux');

    const runError = await runPromise.catch((error: unknown) => error);
    const expectedFailureFields = expect.objectContaining({
      endpointId: "private-telegram",
      transport: "telegram",
      conversationId: "42",
      messageId: "2",
      correlationId: "corr-2",
      agentId: "default",
      step: "pipeline",
      status: "failed",
      errorType: "AgentExecutionError",
      errorMessage: 'Agent "default" failed: No API key for provider: faux',
      agentStopReason: "error",
      upstreamErrorMessage: "No API key for provider: faux",
      upstreamProvider: "faux",
      upstreamModel: "faux-1",
      upstreamApi: registration.api,
      upstreamResponseId: "resp-1",
      assistantContentTypes: [],
      assistantTextLength: 0,
      assistantToolCallNames: [],
      assistantHasThinking: false,
    });
    expect(logger.debug).toHaveBeenCalledWith("agent-engine.pipeline", expectedFailureFields);
    expect(logger.error).toHaveBeenCalledWith(
      "agent engine run failed",
      expectedFailureFields,
      runError,
    );
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
    let capturedToolExecution: AgentOptions["toolExecution"] | undefined;
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
        capturedToolExecution = options.toolExecution;
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
    expect(capturedToolExecution).toBe("parallel");
  });

  it("executes independent tool calls in parallel through the agent core", async () => {
    const registration = registerFauxProvider({
      provider: "faux",
      models: [{ id: "faux-1", name: "Faux 1" }],
    });
    registrations.push(registration);

    const executionEvents: string[] = [];
    const createSlowTool = (name: string): ToolDefinition => ({
      name,
      label: name,
      description: `${name} test tool`,
      parameters: Type.Object({}),
      async execute() {
        executionEvents.push(`${name}:start`);
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        executionEvents.push(`${name}:end`);
        return {
          content: [{ type: "text", text: `${name} done` }],
          details: { name },
        };
      },
    });
    const slowA = createSlowTool("slow_a");
    const slowB = createSlowTool("slow_b");
    const tools = [slowA, slowB];

    registration.setResponses([
      () =>
        fauxAssistantMessage(
          [
            {
              type: "toolCall",
              id: "call-a",
              name: "slow_a",
              arguments: {},
            },
            {
              type: "toolCall",
              id: "call-b",
              name: "slow_b",
              arguments: {},
            },
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage("parallel done"),
    ]);

    const engine = createPiAgentEngine({
      resolveModel: () => registration.getModel("faux-1"),
      readTextFile: async () => "unused context",
      toolRegistry: {
        list: () => tools,
        get: (name) => tools.find((tool) => tool.name === name),
        pick: (names) => names.flatMap((name) => tools.find((tool) => tool.name === name) ?? []),
      },
    });

    const result = await engine.run({
      agent: {
        ...createAgent(),
        tools: ["slow_a", "slow_b"],
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(result.message.text).toBe("parallel done");
    expect(executionEvents.indexOf("slow_b:start")).toBeLessThan(
      executionEvents.indexOf("slow_a:end"),
    );
    expect(executionEvents.indexOf("slow_a:start")).toBeLessThan(
      executionEvents.indexOf("slow_b:end"),
    );
  });

  it("registers delegated agent tools and executes child runs with the child's prompt, model, tools, and workspace", async () => {
    let parentTools: ToolDefinition[] | undefined;
    let childTools: ToolDefinition[] | undefined;
    let childSystemPrompt: string | undefined;
    let childModelId: string | undefined;

    const parentAgent: AgentDefinition = {
      ...createAgent(),
      model: {
        provider: "openai",
        modelId: "parent-model",
      },
      delegations: [
        {
          agentId: "helper",
          toolName: "ask_helper",
        },
      ],
    };
    const childAgent: AgentDefinition = {
      ...createAgent(),
      id: "helper",
      name: "Helper",
      prompt: {
        base: {
          text: createInlineBasePrompt("Child mode {{invocation.kind}} {{output.mode}} {{reply.channel.kind}}."),
        },
      },
      model: {
        provider: "openai",
        modelId: "child-model",
      },
      tools: ["pwd"],
      workspace: {
        cwd: "/tmp/child-workspace",
      },
      delegations: [],
    };

    const engine = createPiAgentEngine({
      agentRegistry: createAgentRegistry([parentAgent, childAgent]),
      resolveModel: (provider, modelId) =>
        ({
          id: modelId,
          provider,
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createAgent: (options) => {
        const modelId = (options.initialState?.model as { id: string }).id;
        const tools = options.initialState?.tools as ToolDefinition[];

        if (modelId === "parent-model") {
          parentTools = tools;
          return createAgentDouble({ messages: [fauxAssistantMessage("parent ready")] });
        }

        childTools = tools;
        childModelId = modelId;
        childSystemPrompt = options.initialState?.systemPrompt;
        return createAgentDouble({ messages: [fauxAssistantMessage("child final text")] });
      },
    });

    await engine.run({
      agent: parentAgent,
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(parentTools?.map((tool) => tool.name)).toContain("ask_helper");

    const delegationTool = parentTools?.find((tool) => tool.name === "ask_helper");
    const result = await delegationTool!.execute("tool-1", { input: "Summarize this" });

    expect(result).toMatchObject({
      content: [{ type: "text", text: "child final text" }],
      details: {
        delegatedAgentId: "helper",
        toolName: "ask_helper",
      },
    });
    expect(childModelId).toBe("child-model");
    expect(childSystemPrompt).toContain("Child mode delegated delegated-tool none.");
    expect(childTools?.map((tool) => tool.name)).toContain("pwd");

    const pwdResult = await childTools!.find((tool) => tool.name === "pwd")!.execute("tool-2", {});
    expect(pwdResult).toMatchObject({
      content: [{ type: "text", text: "/tmp/child-workspace" }],
    });
  });

  it("rejects self-delegation tool execution clearly", async () => {
    let capturedTools: ToolDefinition[] | undefined;
    const agent: AgentDefinition = {
      ...createAgent(),
      delegations: [
        {
          agentId: "default",
          toolName: "ask_self",
        },
      ],
    };

    const engine = createPiAgentEngine({
      agentRegistry: createAgentRegistry([agent]),
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createAgent: (options) => {
        capturedTools = options.initialState?.tools as ToolDefinition[];
        return createAgentDouble({ messages: [fauxAssistantMessage("parent ready")] });
      },
    });

    await engine.run({
      agent,
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    await expect(
      capturedTools!.find((tool) => tool.name === "ask_self")!.execute("tool-1", { input: "hello" }),
    ).rejects.toMatchObject({
      kind: "tool_command_execution",
      message: 'Agent "default" cannot delegate to itself.',
    } satisfies Partial<UserVisibleProcessingError>);
  });

  it("rejects nested delegated agent calls after depth one", async () => {
    let capturedTools: ToolDefinition[] | undefined;
    const childAgent: AgentDefinition = {
      ...createAgent(),
      id: "child",
      name: "Child",
      delegations: [
        {
          agentId: "helper",
          toolName: "ask_helper",
        },
      ],
    };
    const helperAgent: AgentDefinition = {
      ...createAgent(),
      id: "helper",
      name: "Helper",
      delegations: [],
    };

    const engine = createPiAgentEngine({
      agentRegistry: createAgentRegistry([childAgent, helperAgent]),
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createAgent: (options) => {
        capturedTools = options.initialState?.tools as ToolDefinition[];
        return createAgentDouble({ messages: [fauxAssistantMessage("child ready")] });
      },
    });

    await engine.run({
      agent: childAgent,
      conversation: createConversation(),
      message: createIncomingMessage(),
      runtime: {
        delegationDepth: 1,
      },
    });

    await expect(
      capturedTools!.find((tool) => tool.name === "ask_helper")!.execute("tool-1", { input: "hello" }),
    ).rejects.toMatchObject({
      kind: "tool_command_execution",
      message: 'Delegated agent calls may only nest one level. Agent "child" cannot delegate again from this run.',
    } satisfies Partial<UserVisibleProcessingError>);
  });

  it("merges resolved MCP tools into the agent runtime and reuses them across agents", async () => {
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
      initializedServerIds: ["echo"],
      failedServerIds: [],
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

    await engine.run({
      agent: {
        ...mcpAgent,
        id: "other",
      },
      conversation: createConversation(),
      message: {
        ...createIncomingMessage(),
        messageId: "4",
        correlationId: "corr-4",
      },
    });

    expect(capturedTools?.map((tool) => tool.name)).toEqual(["read", "echo__say"]);
    expect(resolveMcpTools).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    await engine.close?.();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails tool resolution when a delegated agent tool collides with an MCP tool", async () => {
    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      resolveMcpTools: async () => ({
        tools: [
          {
            name: "ask_helper",
            label: "ask_helper",
            description: "conflicting MCP tool",
            parameters: Type.Object({}),
            async execute() {
              return {
                content: [{ type: "text" as const, text: "ok" }],
                details: {},
              };
            },
          },
        ],
        initializedServerIds: ["echo"],
        failedServerIds: [],
        close: async () => {},
      }),
      createAgent: () => createAgentDouble({ messages: [fauxAssistantMessage("ok")] }),
      agentRegistry: createAgentRegistry([
        createAgent(),
        {
          ...createAgent(),
          id: "helper",
          name: "helper",
          prompt: {
            base: {
              text: "You are the helper.",
            },
          },
        },
      ]),
    });

    await expect(
      engine.run({
        agent: {
          ...createAgent(),
          delegations: [
            {
              agentId: "helper",
              toolName: "ask_helper",
            },
          ],
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
      }),
    ).rejects.toThrow(
      'Duplicate tool names for agent "default": ask_helper. Tool names must be unique across built-in tools, delegated agent tools, and MCP tools.',
    );
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
        initializedServerIds: [],
        failedServerIds: [],
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

  it("logs resolved tool details during tool resolution", async () => {
    const logger = createMockLogger();

    const engine = createPiAgentEngine({
      logger,
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      resolveMcpTools: async () => ({
        tools: [
          {
            name: "tavily__tavily_search",
            label: "tavily_search",
            description: "search the web",
            parameters: Type.Object({ query: Type.String() }),
            async execute() {
              return {
                content: [{ type: "text" as const, text: "ok" }],
                details: {},
              };
            },
          },
        ],
        initializedServerIds: ["tavily"],
        failedServerIds: [],
        close: async () => {},
      }),
      createAgent: () => createAgentDouble({ messages: [fauxAssistantMessage("ok")] }),
    });

    await engine.run({
      agent: {
        ...createAgent(),
        workspace: {
          cwd: "/tmp/scryer",
        },
        tools: ["read", "bash"],
        mcp: {
          servers: [
            {
              id: "tavily",
              command: process.execPath,
              args: ["echo"],
            },
          ],
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(logger.debug).toHaveBeenCalledWith("agent-engine.pipeline", {
      endpointId: "private-telegram",
      transport: "telegram",
      conversationId: "42",
      messageId: "2",
      correlationId: "corr-2",
      agentId: "default",
      step: "tool-resolution",
      status: "completed",
      initialWorkingDirectory: "/tmp/scryer",
      configuredBuiltInTools: ["read", "bash"],
      resolvedBuiltInTools: ["read", "bash"],
      missingBuiltInTools: [],
      configuredMcpServers: ["tavily"],
      initializedMcpServers: ["tavily"],
      failedMcpServers: [],
      resolvedMcpTools: ["tavily__tavily_search"],
      resolvedTools: ["read", "bash", "tavily__tavily_search"],
    });
  });

  it("logs resolved system prompt source details without prompt content", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-system-prompt-sources-"));
    tempDirs.push(root);
    const agentHome = join(root, "agent-home");
    const workspace = join(root, "workspace");
    const basePromptFile = join(root, "SYSTEM.md");
    const agentHomeInstructionFile = join(agentHome, "AGENT.md");
    const configuredInstructionFile = join(workspace, "RULES.md");
    const workspaceInstructionFile = join(workspace, "AGENTS.md");
    const referenceFile = join(workspace, "RUNBOOK.md");
    await mkdir(agentHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(basePromptFile, "Base prompt secret content.", "utf8");
    await writeFile(agentHomeInstructionFile, "Agent home secret content.", "utf8");
    await writeFile(configuredInstructionFile, "Configured instruction secret content.", "utf8");
    await writeFile(workspaceInstructionFile, "Workspace instruction secret content.", "utf8");
    await writeFile(referenceFile, "Reference secret content.", "utf8");
    const logger = createMockLogger();

    const engine = createPiAgentEngine({
      logger,
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      createAgent: () => createAgentDouble({ messages: [fauxAssistantMessage("ok")] }),
    });

    await engine.run({
      agent: {
        ...createAgent(),
        home: agentHome,
        prompt: {
          base: { file: basePromptFile },
          instructions: [{ file: configuredInstructionFile }],
          references: [{ file: referenceFile }],
        },
        workspace: {
          cwd: workspace,
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
    });

    expect(logger.debug).toHaveBeenCalledWith("resolved system prompt sources", {
      endpointId: "private-telegram",
      transport: "telegram",
      conversationId: "42",
      messageId: "2",
      correlationId: "corr-2",
      agentId: "default",
      cacheHit: false,
      basePromptSource: "file",
      basePromptFile,
      instructionFileCount: 3,
      instructionFiles: [agentHomeInstructionFile, configuredInstructionFile, workspaceInstructionFile],
      configuredInstructionFileCount: 1,
      configuredInstructionFiles: [configuredInstructionFile],
      agentHomeInstructionFileCount: 1,
      agentHomeInstructionFiles: [agentHomeInstructionFile],
      workspaceInstructionFile,
      referenceFileCount: 1,
      referenceFiles: [referenceFile],
      configuredReferenceFileCount: 1,
      configuredReferenceFiles: [referenceFile],
    });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain("secret content");
  });

  it("exposes the resolved system prompt for session snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-system-prompt-snapshot-"));
    tempDirs.push(root);
    const workspace = join(root, "workspace");
    const instructionFile = join(workspace, "AGENTS.md");
    await mkdir(workspace, { recursive: true });
    await writeFile(instructionFile, "Use only verified facts.", "utf8");
    const onSystemPromptResolved = vi.fn(async () => undefined);

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      createAgent: () => createAgentDouble({ messages: [fauxAssistantMessage("ok")] }),
    });

    await engine.run({
      agent: {
        ...createAgent(),
        prompt: {
          base: {
            text:
              "Base prompt.\n\n" +
              '{{promptSections "INSTRUCTIONS" prompt.instructions}}',
          },
          instructions: [{ file: instructionFile }],
        },
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
      onSystemPromptResolved,
    });

    expect(onSystemPromptResolved).toHaveBeenCalledWith({
      messageId: "2",
      correlationId: "corr-2",
      agentId: "default",
      createdAt: expect.any(String),
      content: renderSystemPromptForTest({
        base: "Base prompt.",
        instructions: [{ source: instructionFile, content: "Use only verified facts." }],
      }),
      cacheHit: false,
      sources: expect.objectContaining({
        basePromptSource: "text",
        instructionFiles: [instructionFile],
        configuredInstructionFiles: [instructionFile],
      }),
    });
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

  it("adds load_skill for available skills and lists bundled resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-load-skill-"));
    tempDirs.push(root);
    const skillDirectoryPath = join(root, "skills", "commit");
    const skillPath = join(skillDirectoryPath, "SKILL.md");
    const referencePath = join(skillDirectoryPath, "references", "checklist.md");
    const scriptPath = join(skillDirectoryPath, "scripts", "prepare.sh");
    await mkdir(skillDirectoryPath, { recursive: true });
    await writeFile(
      skillPath,
      "---\nname: commit\ndescription: Stage and commit changes.\n---\n\nUse focused commits.\n\nCatalogs:\n{{#each imp.skillCatalogs}}\n- {{label}}: {{path}}\n{{/each}}\nDynamic: {{imp.dynamicWorkspaceSkillsPath}}",
      "utf8",
    );
    await mkdir(dirname(referencePath), { recursive: true });
    await writeFile(referencePath, "Review staged files first.\n", "utf8");
    await mkdir(dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, "#!/usr/bin/env bash", "utf8");

    let capturedTools: ToolDefinition[] | undefined;

    const engine = createPiAgentEngine({
      resolveModel: () =>
        ({
          id: "gpt-5.4",
          provider: "openai",
          api: "openai-responses",
        }) as never,
      readTextFile: async () => "unused context",
      createAgent: (options) => {
        capturedTools = options.initialState?.tools as ToolDefinition[];
        return createAgentDouble({ messages: [fauxAssistantMessage("skill-ready")] });
      },
    });

    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
      runtime: {
        dataRoot: "/var/lib/imp",
        availableSkills: [
          {
            name: "commit",
            description: "Stage and commit changes.",
            directoryPath: skillDirectoryPath,
            filePath: skillPath,
            body: "\nStale catalog body.",
            content: "---\nname: commit\ndescription: Stage and commit changes.\n---\n\nStale catalog body.",
            references: [
              {
                filePath: referencePath,
                relativePath: "checklist.md",
              },
            ],
            scripts: [
              {
                filePath: scriptPath,
                relativePath: "prepare.sh",
              },
            ],
          },
        ],
      },
    });

    const loadSkill = capturedTools?.find((tool) => tool.name === "load_skill");
    expect(loadSkill).toBeDefined();
    expect(loadSkill!.parameters).toMatchObject({
      properties: {
        name: {
          enum: ["commit"],
        },
      },
    });

    const result = await loadSkill!.execute("load-1", { name: "commit" });
    const text = result.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");

    expect(text).toContain('<skill_content name="commit">');
    expect(text).toContain("Use focused commits.");
    expect(text).toContain("Catalogs:");
    expect(text).toContain("- global shared catalog: /var/lib/imp/skills");
    expect(text).toContain("Dynamic:");
    expect(text).not.toContain("description: Stage and commit changes.");
    expect(text).not.toContain("Stale catalog body.");
    expect(text).not.toContain("{{#each imp.skillCatalogs}}");
    expect(text).toContain(`Skill directory: ${skillDirectoryPath}`);
    expect(text).toContain("<skill_resources>");
    expect(text).toContain(`<file kind="script" path="${scriptPath}">scripts/prepare.sh</file>`);
    expect(text).toContain(`<file kind="reference" path="${referencePath}">references/checklist.md</file>`);
    expect(text).not.toContain("Review staged files first.");
    expect(result.details).toMatchObject({
      skillName: "commit",
      skillPath,
      skillDirectoryPath,
      references: [
        {
          path: referencePath,
          relativePath: "references/checklist.md",
        },
      ],
      scripts: [
        {
          path: scriptPath,
          relativePath: "scripts/prepare.sh",
        },
      ],
    });
  });

  it("reloads skill content and bundled resources from disk on same-turn load_skill calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-load-skill-reload-"));
    tempDirs.push(root);
    const skillDirectoryPath = join(root, "skills", "commit");
    const skillPath = join(skillDirectoryPath, "SKILL.md");
    const firstScriptPath = join(skillDirectoryPath, "scripts", "first.sh");
    const secondReferencePath = join(skillDirectoryPath, "references", "second.md");
    await mkdir(dirname(firstScriptPath), { recursive: true });
    await writeFile(
      skillPath,
      "---\nname: commit\ndescription: Stage and commit changes.\n---\n\nFirst instructions.",
      "utf8",
    );
    await writeFile(firstScriptPath, "#!/usr/bin/env bash", "utf8");

    const loadSkill = createLoadSkillTool([
      {
        name: "commit",
        description: "Stage and commit changes.",
        directoryPath: skillDirectoryPath,
        filePath: skillPath,
        body: "\nStale first instructions.",
        content: "---\nname: commit\ndescription: Stage and commit changes.\n---\n\nStale first instructions.",
        references: [],
        scripts: [
          {
            filePath: firstScriptPath,
            relativePath: "first.sh",
          },
        ],
      },
    ]);

    const firstResult = await loadSkill.execute("load-1", { name: "commit" });
    const firstText = firstResult.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");
    expect(firstText).toContain("First instructions.");
    expect(firstText).toContain(`<file kind="script" path="${firstScriptPath}">scripts/first.sh</file>`);

    await writeFile(
      skillPath,
      "---\nname: edited-name\ndescription: Edited during the same turn.\n---\n\nSecond instructions.",
      "utf8",
    );
    await mkdir(dirname(secondReferencePath), { recursive: true });
    await writeFile(secondReferencePath, "Reference content", "utf8");

    const secondResult = await loadSkill.execute("load-2", { name: "commit" });
    const secondText = secondResult.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");

    expect(secondText).toContain('<skill_content name="commit">');
    expect(secondText).toContain("Second instructions.");
    expect(secondText).not.toContain("First instructions.");
    expect(secondText).toContain(`<file kind="reference" path="${secondReferencePath}">references/second.md</file>`);
    expect(secondResult.details).toMatchObject({
      skillName: "commit",
      references: [
        {
          path: secondReferencePath,
          relativePath: "references/second.md",
        },
      ],
    });
    expect(loadSkill.parameters).toMatchObject({
      properties: {
        name: {
          enum: ["commit"],
        },
      },
    });
    await expect(loadSkill.execute("load-3", { name: "edited-name" })).rejects.toMatchObject({
      kind: "tool_command_execution",
      message: "Unknown skill: edited-name. Available skills: commit",
    } satisfies Partial<UserVisibleProcessingError>);
  });

  it("maps load_skill parameter validation failures to typed processing errors", async () => {
    const loadSkill = createLoadSkillTool([]);

    await expect(loadSkill.execute("load-1", undefined)).rejects.toMatchObject({
      kind: "tool_command_execution",
      message: "load_skill requires an object parameter with a name.",
    } satisfies Partial<UserVisibleProcessingError>);
  });

  it("allows agents to update a visible multi-step plan", async () => {
    const registry = createBuiltInToolRegistry(process.cwd());
    const updatePlan = registry.get("update_plan");

    expect(updatePlan).toBeDefined();
    expect(updatePlan?.parameters).toMatchObject({
      properties: {
        plan: {
          items: {
            properties: {
              status: {
                enum: ["pending", "in_progress", "completed"],
              },
            },
          },
        },
      },
    });

    const result = await updatePlan!.execute("plan-1", {
      explanation: "After inspecting the repo.",
      plan: [
        { step: "Inspect tool registry", status: "completed" },
        { step: "Implement update_plan", status: "in_progress" },
        { step: "Run tests", status: "pending" },
      ],
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text:
            "Plan updated.\n" +
            "Explanation: After inspecting the repo.\n" +
            "completed: Inspect tool registry\n" +
            "in_progress: Implement update_plan\n" +
            "pending: Run tests",
        },
      ],
      details: {
        explanation: "After inspecting the repo.",
        plan: [
          { step: "Inspect tool registry", status: "completed" },
          { step: "Implement update_plan", status: "in_progress" },
          { step: "Run tests", status: "pending" },
        ],
      },
    });
  });

  it("maps update_plan parameter validation failures to typed processing errors", async () => {
    const updatePlan = createBuiltInToolRegistry(process.cwd()).get("update_plan");

    await expect(updatePlan!.execute("plan-1", undefined)).rejects.toMatchObject({
      kind: "tool_command_execution",
      message: "update_plan requires an object parameter with a plan array.",
    } satisfies Partial<UserVisibleProcessingError>);

    await expect(
      updatePlan!.execute("plan-2", {
        plan: [
          { step: "First active step", status: "in_progress" },
          { step: "Second active step", status: "in_progress" },
        ],
      }),
    ).rejects.toMatchObject({
      kind: "tool_command_execution",
      message: "update_plan accepts at most one in_progress step.",
    } satisfies Partial<UserVisibleProcessingError>);
  });

  it("marks stateful and mutating built-in tools for sequential execution", () => {
    const registry = createBuiltInToolRegistry(process.cwd(), createAgent());

    for (const toolName of ["bash", "edit", "write", "cd", "update_plan"]) {
      expect(registry.get(toolName)?.executionMode).toBe("sequential");
    }

    for (const toolName of ["read", "grep", "find", "ls", "pwd"]) {
      expect(registry.get(toolName)?.executionMode).toBeUndefined();
    }
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

  it("resolves relative cd targets from the current agent working directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-working-directory-"));
    tempDirs.push(root);
    const workspaceDir = join(root, "workspace");
    const nestedDir = join(workspaceDir, "nested");
    await mkdir(nestedDir, { recursive: true });

    const registry = createBuiltInToolRegistry(workspaceDir);
    const setWorkingDirectory = registry.get("cd");
    const getWorkingDirectory = registry.get("pwd");

    await expect(setWorkingDirectory!.execute("1", { path: "nested" })).resolves.toMatchObject({
      details: { workingDirectory: nestedDir },
    });
    await expect(getWorkingDirectory!.execute("2", {})).resolves.toMatchObject({
      details: { workingDirectory: nestedDir },
    });
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

  it("does not register phone tools as built-ins", () => {
    const registry = createBuiltInToolRegistry(process.cwd(), {
      ...createAgent(),
      phone: {
        contacts: [
          {
            id: "office",
            name: "Office",
            uri: "sip:office@example.com",
          },
        ],
      },
    });

    expect(registry.get("phone_call")).toBeUndefined();
    expect(registry.get("phone_hangup")).toBeUndefined();
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

    await expect(setWorkingDirectory!.execute("1", { path: filePath })).rejects.toMatchObject({
      kind: "file_document_persistence",
      message: `Not a directory: ${filePath}`,
    } satisfies Partial<UserVisibleProcessingError>);
  });

  it("maps missing cd targets to typed file operation errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-working-directory-"));
    tempDirs.push(root);
    const missingPath = join(root, "missing");

    const registry = createBuiltInToolRegistry(root);
    const setWorkingDirectory = registry.get("cd");

    await expect(setWorkingDirectory!.execute("1", { path: missingPath })).rejects.toMatchObject({
      kind: "file_document_persistence",
      message: expect.stringContaining(`stat '${missingPath}'`),
    } satisfies Partial<UserVisibleProcessingError>);
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
        expectSystemPrompt(context.systemPrompt, {
          base: "You are concise.",
          instructions: [
            {
              source: "/workspace/RULES.md",
              content: "Follow the explicit rules.",
            },
            {
              source: "/workspace/project/AGENTS.md",
              content: "Follow the workspace instructions.",
            },
          ],
        });
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
        expectSystemPrompt(context.systemPrompt, {
          base: "You are concise.",
          instructions: [
            {
              source: "/workspace/RULES.md",
              content: "Follow the explicit rules.",
            },
            {
              source: "/workspace/project/AGENTS.md",
              content: "Follow the workspace instructions.",
            },
          ],
        });
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
        expectSystemPrompt(context.systemPrompt, {
          base: "You are concise.",
          instructions: [
            {
              source: "/workspace/next/AGENTS.md",
              content: "Follow the next workspace instructions.",
            },
          ],
        });
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
            text:
              "You are concise.\n\n" +
              '{{promptSections "INSTRUCTIONS" prompt.instructions}}',
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
        expectSystemPrompt(context.systemPrompt, { base: "You are concise." });
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
        expectSystemPrompt(context.systemPrompt, {
          base: "You are concise.",
          instructions: [
            {
              source: "/workspace/project/AGENTS.md",
              content: "Follow the workspace instructions.",
            },
          ],
        });
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
        expect(context.systemPrompt).toBe("You are defined in a file.");
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
    const onSystemPromptResolved = vi.fn(async () => undefined);

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
      onSystemPromptResolved,
    });
    await engine.run({
      agent: createAgent(),
      conversation: createConversation(),
      message: createIncomingMessage(),
      onSystemPromptResolved,
    });

    expect(fingerprintCalls).toEqual([
      "/workspace/AGENTS.md",
      "/workspace/AGENTS.md",
    ]);
    expect(readCalls).toEqual(["/workspace/AGENTS.md"]);
    expect(onSystemPromptResolved).toHaveBeenCalledOnce();
    expect(onSystemPromptResolved).toHaveBeenCalledWith(expect.objectContaining({
      cacheHit: false,
    }));
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
        return "Endpoint {{endpoint.id}} in {{imp.dataRoot}}.";
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
        endpointId: "ops-telegram",
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
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\nEndpoint private-telegram in /var/lib/imp-a.\n</INSTRUCTIONS>',
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\nEndpoint ops-telegram in /var/lib/imp-b.\n</INSTRUCTIONS>',
    ]);
  });

  it("invalidates the cached system prompt when context fingerprints change", async () => {
    const readCalls: string[] = [];
    const contextByFingerprint = new Map([
      ["mtime:1:size:100", "context alpha"],
      ["mtime:2:size:100", "context beta"],
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
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\ncontext alpha\n</INSTRUCTIONS>',
      'You are concise.\n\n<INSTRUCTIONS from="/workspace/AGENTS.md">\n\ncontext beta\n</INSTRUCTIONS>',
    ]);
  });

  it("fails clearly when an agent defines no usable base prompt", async () => {
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
    ).rejects.toThrow('Configured base prompt for agent "default" must define text, file, or built-in source.');
  });
});

type AgentDouble = Pick<Agent, "continue" | "prompt" | "subscribe"> & {
  state: Pick<Agent["state"], "messages">;
};

interface AgentDoubleOptions {
  messages?: AgentMessage[];
  events?: AgentEvent[];
  onPrompt?: (
    input: AgentMessage | AgentMessage[] | string,
    images?: ImageContent[],
  ) => Promise<void> | void;
  onContinue?: () => Promise<void> | void;
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

  async function continueRun(): Promise<void> {
    await options.onContinue?.();

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
    continue: continueRun,
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
        text: createInlineBasePrompt("You are concise."),
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
        id: "1:assistant:1",
        role: "assistant",
        content: [{ type: "text", text: "hi there" }],
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
        stopReason: "stop",
        createdAt: "2026-04-05T00:00:01.000Z",
      },
    ],
  };
}

function createIncomingMessage(): IncomingMessage {
  return {
    endpointId: "private-telegram",
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
