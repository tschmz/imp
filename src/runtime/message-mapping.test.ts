import type { Model } from "@mariozechner/pi-ai";
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
  it("replays persisted tool history as plain assistant transcript for responses reasoning models", () => {
    const messages = toAgentMessages(
      [
        {
          kind: "message",
          id: "1:user",
          role: "user",
          text: "hello",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
        {
          kind: "tool-call",
          id: "1:tool-call:1",
          createdAt: "2026-04-05T00:00:01.000Z",
          text: "Checking the repo.",
          toolCalls: [
            {
              id: "call_123|fc_123",
              name: "read_file",
              arguments: { path: "README.md" },
            },
          ],
        },
        {
          kind: "tool-result",
          id: "1:tool-result:1",
          createdAt: "2026-04-05T00:00:02.000Z",
          toolCallId: "call_123|fc_123",
          toolName: "read_file",
          content: [{ type: "text", text: "README contents" }],
          details: { path: "README.md" },
          isError: false,
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
        stopReason: "stop",
        content: [
          {
            type: "text",
            text:
              "[Persisted tool transcript]\n" +
              "Assistant used tools in a previous turn.\n" +
              "Assistant note: Checking the repo.\n" +
              "Tool: read_file\n" +
              "Tool call id: call_123|fc_123\n" +
              'Arguments: {"path":"README.md"}',
          },
        ],
      }),
      expect.objectContaining({
        role: "assistant",
        stopReason: "stop",
        content: [
          {
            type: "text",
            text:
              "[Persisted tool transcript]\n" +
              "Tool result from read_file (ok) in a previous turn.\n" +
              "Tool call id: call_123|fc_123\n" +
              "Output:\n" +
              "README contents\n" +
              'Details: {"path":"README.md"}',
          },
        ],
      }),
    ]);
    expect(messages.some((message) => message.role === "toolResult")).toBe(false);
    expect(
      messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some((content) => content.type === "toolCall"),
      ),
    ).toBe(false);
  });
});
