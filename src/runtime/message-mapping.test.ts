import type { Model } from "@mariozechner/pi-ai";
import { convertResponsesMessages } from "../../node_modules/@mariozechner/pi-ai/dist/providers/openai-responses-shared.js";
import { describe, expect, it } from "vitest";
import type { ConversationEvent } from "../domain/conversation.js";
import { toAgentMessages } from "./message-mapping.js";

const reasoningResponsesModel: Model<"openai-responses"> = {
  id: "gpt-5-mini",
  name: "GPT-5 Mini",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
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

describe("toAgentMessages", () => {
  it("replays persisted OpenAI reasoning and tool history as native messages", () => {
    const messages = toAgentMessages(
      [
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
          content: [
            {
              type: "thinking",
              thinking: "",
              thinkingSignature: JSON.stringify({
                type: "reasoning",
                id: "rs_123",
                summary: [],
                encrypted_content: "enc",
              }),
              redacted: true,
            },
            {
              type: "text",
              text: "Checking the repo.",
              textSignature: JSON.stringify({ v: 1, id: "msg_123", phase: "commentary" }),
            },
            {
              type: "toolCall",
              id: "call_123|fc_123",
              name: "read_file",
              arguments: { path: "README.md" },
              thoughtSignature: "sig_123",
            },
          ],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          responseId: "resp_123",
          usage: {
            input: 11,
            output: 7,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 18,
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
          toolCallId: "call_123|fc_123",
          toolName: "read_file",
          content: [{ type: "text", text: "README contents" }],
          details: { path: "README.md" },
          isError: false,
          timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
          createdAt: "2026-04-05T00:00:02.000Z",
        },
      ] satisfies ConversationEvent[],
      reasoningResponsesModel,
    );

    expect(messages).toEqual([
      {
        role: "user",
        content: "hello",
        timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
      },
      expect.objectContaining({
        role: "assistant",
        responseId: "resp_123",
        stopReason: "toolUse",
        content: [
          expect.objectContaining({
            type: "thinking",
            thinkingSignature: expect.any(String),
          }),
          expect.objectContaining({
            type: "text",
            text: "Checking the repo.",
            textSignature: expect.any(String),
          }),
          expect.objectContaining({
            type: "toolCall",
            id: "call_123|fc_123",
            name: "read_file",
            thoughtSignature: "sig_123",
          }),
        ],
      }),
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "call_123|fc_123",
        toolName: "read_file",
        content: [{ type: "text", text: "README contents" }],
      }),
    ]);
  });

  it("preserves replay metadata needed by openai-responses-shared", () => {
    const messages = toAgentMessages(
      [
        {
          kind: "message",
          id: "1:assistant:1",
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "",
              thinkingSignature: JSON.stringify({
                type: "reasoning",
                id: "rs_123",
                summary: [],
                encrypted_content: "enc",
              }),
              redacted: true,
            },
            {
              type: "text",
              text: "Checking the repo.",
              textSignature: JSON.stringify({ v: 1, id: "msg_123", phase: "commentary" }),
            },
            {
              type: "toolCall",
              id: "call_123|fc_123",
              name: "read_file",
              arguments: { path: "README.md" },
              thoughtSignature: "sig_123",
            },
          ],
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
          toolCallId: "call_123|fc_123",
          toolName: "read_file",
          content: [{ type: "text", text: "README contents" }],
          isError: false,
          timestamp: Date.parse("2026-04-05T00:00:02.000Z"),
          createdAt: "2026-04-05T00:00:02.000Z",
        },
      ] satisfies ConversationEvent[],
      reasoningResponsesModel,
    );

    const replayPayload = convertResponsesMessages(
      reasoningResponsesModel,
      {
        messages,
      },
      new Set(["openai"]),
    );

    expect(replayPayload).toEqual([
      expect.objectContaining({
        type: "reasoning",
        id: "rs_123",
      }),
      expect.objectContaining({
        type: "message",
        id: "msg_123",
        phase: "commentary",
      }),
      expect.objectContaining({
        type: "function_call",
        call_id: "call_123",
        id: "fc_123",
        name: "read_file",
      }),
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_123",
        output: "README contents",
      }),
    ]);
  });
});
