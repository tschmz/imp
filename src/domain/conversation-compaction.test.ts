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

  it("uses a token-budget suffix when the latest user turn would keep too much context", () => {
    const conversation = createConversation({
      messages: [
        createUserMessage("u1", "Review the last commit.", "2026-04-05T00:00:00.000Z"),
        createUserMessage("u2", "Give interim commentaries.", "2026-04-05T00:00:10.000Z"),
        createAssistantMessage("a1", "Early review output. ".repeat(400), "2026-04-05T00:00:20.000Z"),
        createToolResultMessage("t1", "Large command output. ".repeat(400), "2026-04-05T00:00:30.000Z"),
        createAssistantMessage("a2", "Recent analysis. ".repeat(400), "2026-04-05T00:00:40.000Z"),
        createAssistantMessage("a3", "Final findings.", "2026-04-05T00:00:50.000Z"),
      ],
    });

    const plan = planConversationCompaction(conversation, {
      force: true,
      keepRecentTokens: 1_000,
    });

    expect(plan?.firstKeptMessageId).toBe("a2");
    expect(plan?.compactedThroughMessageId).toBe("t1");
    expect(plan?.messagesToSummarize.map((message) => message.id)).toEqual(["u1", "u2", "a1", "t1"]);
    expect(plan?.recentMessages.map((message) => message.id)).toEqual(["a2", "a3"]);
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
    messages?: ConversationContext["messages"];
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
    messages: options.messages ?? [
      createUserMessage("u1", "What are we doing?", "2026-04-05T00:00:00.000Z"),
      createAssistantMessage("a1", "We are preparing a release.", "2026-04-05T00:01:00.000Z", "resp-1"),
      createUserMessage("u2", "What next?", "2026-04-05T00:02:00.000Z"),
      createAssistantMessage(
        "a2",
        "Run the checks.",
        options.postCompactionAssistantAt ?? "2026-04-05T00:02:15.000Z",
        "resp-2",
      ),
    ],
  };
}

function createUserMessage(id: string, content: string, createdAt: string) {
  return {
    kind: "message" as const,
    id,
    role: "user" as const,
    content,
    timestamp: Date.parse(createdAt),
    createdAt,
  };
}

function createAssistantMessage(
  id: string,
  text: string,
  createdAt: string,
  responseId?: string,
) {
  return {
    kind: "message" as const,
    id,
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "openai",
    model: "gpt-5-mini",
    ...(responseId ? { responseId } : {}),
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.parse(createdAt),
    createdAt,
  };
}

function createToolResultMessage(id: string, text: string, createdAt: string) {
  return {
    kind: "message" as const,
    id,
    role: "toolResult" as const,
    toolCallId: `call-${id}`,
    toolName: "bash",
    content: [{ type: "text" as const, text }],
    timestamp: Date.parse(createdAt),
    createdAt,
    isError: false,
  };
}
