import type { Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { ConversationEvent } from "../domain/conversation.js";
import { resolvePreviousResponseState, supportsPreviousResponseId } from "./response-conversation-state.js";

const responsesModel: Model<"openai-responses"> = {
  id: "gpt-5-mini",
  name: "GPT-5 Mini",
  api: "openai-responses",
  provider: "openai",
  baseUrl: ["https://api.openai.com", "v" + "1"].join("/"),
  reasoning: true,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 200000,
  maxTokens: 100000,
};


describe("supportsPreviousResponseId", () => {
  it("allows server-side response state only for known native Responses providers", () => {
    expect(supportsPreviousResponseId(responsesModel)).toBe(true);
    expect(supportsPreviousResponseId({
      ...responsesModel,
      provider: "custom-proxy",
      baseUrl: "https://proxy.example.test/v1",
    })).toBe(false);
    expect(supportsPreviousResponseId({
      ...responsesModel,
      baseUrl: "https://proxy.example.test/v1",
    })).toBe(false);
    expect(supportsPreviousResponseId({
      ...responsesModel,
      api: "azure-openai-responses",
      provider: "azure-openai-responses",
    })).toBe(true);
    expect(supportsPreviousResponseId({
      ...responsesModel,
      api: "openai-codex-responses",
      provider: "openai-codex",
    })).toBe(false);
  });
});

describe("resolvePreviousResponseState", () => {
  it("uses the latest matching assistant response id and keeps only messages after it", () => {
    const messages = [
      {
        kind: "message",
        id: "1:user",
        role: "user",
        content: "hello",
        timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        kind: "message",
        id: "1:assistant:1",
        role: "assistant",
        content: [{ type: "text", text: "Let me check." }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5-mini",
        responseId: "resp_123",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
        createdAt: "2026-04-05T00:00:01.000Z",
      },
      {
        kind: "message",
        id: "1:tool-result:1",
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read_file",
        content: [{ type: "text", text: "README contents" }],
        isError: false,
        timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
        createdAt: "2026-04-05T00:00:02.000Z",
      },
    ] satisfies ConversationEvent[];

    const state = resolvePreviousResponseState(messages, responsesModel);

    expect(state).toEqual({
      previousResponseId: "resp_123",
      conversationMessages: [messages[2]],
    });
  });

  it("falls back to full replay for OpenAI-compatible custom Responses providers", () => {
    const messages = [
      {
        kind: "message",
        id: "1:user",
        role: "user",
        content: "hello",
        timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        kind: "message",
        id: "1:assistant:1",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        api: "openai-responses",
        provider: "custom-proxy",
        model: "custom-model",
        responseId: "resp_123",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
        createdAt: "2026-04-05T00:00:01.000Z",
      },
    ] satisfies ConversationEvent[];

    const state = resolvePreviousResponseState(messages, {
      ...responsesModel,
      provider: "custom-proxy",
      baseUrl: "https://proxy.example.test/v1",
    });

    expect(state).toEqual({
      conversationMessages: messages,
    });
  });

  it("falls back to full replay when the latest matching responses assistant ended in error", () => {
    const messages = [
      {
        kind: "message",
        id: "1:user",
        role: "user",
        content: "hello",
        timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        kind: "message",
        id: "1:assistant:1",
        role: "assistant",
        content: [{ type: "text", text: "Let me check." }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5-mini",
        responseId: "resp_123",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        errorMessage: "upstream failed",
        timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
        createdAt: "2026-04-05T00:00:01.000Z",
      },
      {
        kind: "message",
        id: "2:user",
        role: "user",
        content: "retry",
        timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
        createdAt: "2026-04-05T00:00:02.000Z",
      },
    ] satisfies ConversationEvent[];

    const state = resolvePreviousResponseState(messages, responsesModel);

    expect(state).toEqual({
      conversationMessages: messages,
    });
  });

  it("falls back to full replay when the latest assistant is not a matching responses message", () => {
    const messages = [
      {
        kind: "message",
        id: "1:user",
        role: "user",
        content: "hello",
        timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        kind: "message",
        id: "1:assistant:1",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5-mini",
        responseId: "resp_123",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.parse("2026-04-05T00:00:01.000Z"),
        createdAt: "2026-04-05T00:00:01.000Z",
      },
      {
        kind: "message",
        id: "2:user",
        role: "user",
        content: "switch agent",
        timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
        createdAt: "2026-04-05T00:00:02.000Z",
      },
      {
        kind: "message",
        id: "2:assistant:1",
        role: "assistant",
        content: [{ type: "text", text: "Using a different provider now." }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.parse("2026-04-05T00:00:03.000Z"),
        createdAt: "2026-04-05T00:00:03.000Z",
      },
    ] satisfies ConversationEvent[];

    const state = resolvePreviousResponseState(messages, responsesModel);

    expect(state).toEqual({
      conversationMessages: messages,
    });
  });
});
