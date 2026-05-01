import { describe, expect, it } from "vitest";
import type { ConversationContext } from "./conversation.js";
import {
  buildCompactedConversationMessages,
  planConversationCompaction,
} from "./conversation-compaction.js";

describe("conversation compaction", () => {
  it("plans forced compaction by summarizing messages before the latest user turn", () => {
    const conversation = createConversation();

    const plan = planConversationCompaction(conversation, { force: true });

    expect(plan?.firstKeptMessageId).toBe("u2");
    expect(plan?.compactedThroughMessageId).toBe("a1");
    expect(plan?.messagesToSummarize.map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(plan?.recentMessages.map((message) => message.id)).toEqual(["u2", "a2"]);
  });

  it("projects a compacted conversation as summary plus recent messages", () => {
    const conversation = createConversation({
      compaction: {
        summary: "Goal: finish the release.\nNext: run tests.",
        firstKeptMessageId: "u2",
        compactedThroughMessageId: "a1",
        createdAt: "2026-04-05T00:02:30.000Z",
        messageCountBefore: 4,
        messageCountSummarized: 2,
        messageCountKept: 2,
        sequence: 1,
      },
    });

    const messages = buildCompactedConversationMessages(conversation);

    expect(messages.map((message) => message.id)).toEqual(["compaction:1:summary", "u2", "a2"]);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("Goal: finish the release."),
    });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      id: "a2",
    });
    expect("responseId" in messages[2]!).toBe(false);
  });

  it("keeps response ids from assistant messages created after compaction", () => {
    const conversation = createConversation({
      compaction: {
        summary: "Earlier work.",
        firstKeptMessageId: "u2",
        compactedThroughMessageId: "a1",
        createdAt: "2026-04-05T00:02:30.000Z",
        messageCountBefore: 4,
        messageCountSummarized: 2,
        messageCountKept: 2,
        sequence: 1,
      },
      postCompactionAssistantAt: "2026-04-05T00:03:00.000Z",
    });

    const messages = buildCompactedConversationMessages(conversation);

    expect(messages[2]).toMatchObject({
      role: "assistant",
      responseId: "resp-2",
    });
  });

  it("falls back to the full conversation when compaction metadata is stale", () => {
    const conversation = createConversation({
      compaction: {
        summary: "Earlier work.",
        firstKeptMessageId: "missing-message",
        compactedThroughMessageId: "a1",
        createdAt: "2026-04-05T00:02:30.000Z",
        messageCountBefore: 4,
        messageCountSummarized: 2,
        messageCountKept: 2,
        sequence: 1,
      },
    });

    const messages = buildCompactedConversationMessages(conversation);

    expect(messages.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });
});

function createConversation(
  options: {
    compaction?: NonNullable<ConversationContext["state"]["compaction"]>;
    postCompactionAssistantAt?: string;
  } = {},
): ConversationContext {
  return {
    state: {
      conversation: {
        transport: "telegram",
        externalId: "42",
        sessionId: "session-1",
      },
      agentId: "default",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:02:00.000Z",
      ...(options.compaction ? { compaction: options.compaction } : {}),
    },
    messages: [
      {
        kind: "message",
        id: "u1",
        role: "user",
        content: "What are we doing?",
        timestamp: Date.parse("2026-04-05T00:00:00.000Z"),
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      {
        kind: "message",
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "We are preparing a release." }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5-mini",
        responseId: "resp-1",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
        createdAt: "2026-04-05T00:01:00.000Z",
      },
      {
        kind: "message",
        id: "u2",
        role: "user",
        content: "What next?",
        timestamp: Date.parse("2026-04-05T00:02:00.000Z"),
        createdAt: "2026-04-05T00:02:00.000Z",
      },
      {
        kind: "message",
        id: "a2",
        role: "assistant",
        content: [{ type: "text", text: "Run the checks." }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5-mini",
        responseId: "resp-2",
        usage: {
          input: 12,
          output: 6,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 18,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.parse(options.postCompactionAssistantAt ?? "2026-04-05T00:02:15.000Z"),
        createdAt: options.postCompactionAssistantAt ?? "2026-04-05T00:02:15.000Z",
      },
    ],
  };
}
