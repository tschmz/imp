import type {
  ConversationAssistantMessage,
  ConversationContext,
  ConversationEvent,
  ConversationToolResultMessage,
  ConversationUserMessage,
} from "./conversation.js";

type SummaryContent = ConversationUserMessage["content"] | ConversationToolResultMessage["content"];

export const DEFAULT_COMPACTION_RESERVE_TOKENS = 8_000;
export const DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 12_000;

export interface ConversationCompactionPlan {
  firstKeptMessageId: string;
  compactedThroughMessageId: string;
  messagesToSummarize: ConversationEvent[];
  recentMessages: ConversationEvent[];
  tokensBefore: number;
  tokensAfter: number;
}

export interface ConversationCompactionPlanningOptions {
  keepRecentTokens?: number;
  force?: boolean;
}

export function planConversationCompaction(
  conversation: ConversationContext,
  options: ConversationCompactionPlanningOptions = {},
): ConversationCompactionPlan | undefined {
  const messages = conversation.messages;
  if (messages.length < 2) {
    return undefined;
  }

  const boundaryStartIndex = resolveCompactionBoundaryStart(conversation);
  const firstKeptIndex = findFirstKeptIndex(messages, boundaryStartIndex, {
    keepRecentTokens: options.keepRecentTokens ?? DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
    force: options.force === true,
  });

  if (firstKeptIndex === undefined || firstKeptIndex <= boundaryStartIndex) {
    return undefined;
  }

  const compactedThrough = messages[firstKeptIndex - 1];
  const firstKept = messages[firstKeptIndex];
  if (!compactedThrough || !firstKept) {
    return undefined;
  }

  const messagesToSummarize = messages.slice(boundaryStartIndex, firstKeptIndex);
  if (messagesToSummarize.length === 0) {
    return undefined;
  }

  const recentMessages = messages.slice(firstKeptIndex);
  const tokensBefore = estimateConversationTokens(buildCompactedConversationMessages(conversation));
  const tokensAfter = estimateConversationTokens(recentMessages);

  return {
    firstKeptMessageId: firstKept.id,
    compactedThroughMessageId: compactedThrough.id,
    messagesToSummarize,
    recentMessages,
    tokensBefore,
    tokensAfter,
  };
}

export function shouldCompactConversation(
  conversation: ConversationContext,
  contextWindow: number,
  reserveTokens = DEFAULT_COMPACTION_RESERVE_TOKENS,
): boolean {
  if (!Number.isFinite(contextWindow) || contextWindow <= reserveTokens) {
    return false;
  }

  const tokens = estimateConversationTokens(buildCompactedConversationMessages(conversation));
  return tokens + reserveTokens >= contextWindow;
}

export function buildCompactedConversationMessages(
  conversation: ConversationContext,
): ConversationEvent[] {
  const compaction = conversation.state.compaction;
  if (!compaction?.summary.trim()) {
    return conversation.messages;
  }

  const firstKeptIndex = conversation.messages.findIndex(
    (message) => message.id === compaction.firstKeptMessageId,
  );
  if (firstKeptIndex < 0) {
    return conversation.messages;
  }

  const recentMessages = conversation.messages.slice(firstKeptIndex);

  return [
    createCompactionSummaryMessage(conversation),
    ...recentMessages.map((message) => stripPreCompactionResponseId(message, compaction.createdAt)),
  ];
}

export function estimateConversationTokens(messages: ConversationEvent[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function serializeConversationEventsForSummary(
  messages: ConversationEvent[],
  options: { maxTotalChars?: number; maxBlockChars?: number } = {},
): string {
  const maxTotalChars = options.maxTotalChars ?? 180_000;
  const maxBlockChars = options.maxBlockChars ?? 4_000;
  const parts: string[] = [];
  let totalChars = 0;

  for (const message of messages) {
    const rendered = truncateText(renderSummaryMessage(message, maxBlockChars), maxBlockChars * 3);
    if (totalChars + rendered.length > maxTotalChars) {
      parts.push("\n[Earlier summary input truncated to fit the compaction request.]");
      break;
    }

    parts.push(rendered);
    totalChars += rendered.length;
  }

  return parts.join("\n\n---\n\n");
}

function resolveCompactionBoundaryStart(conversation: ConversationContext): number {
  const firstKeptMessageId = conversation.state.compaction?.firstKeptMessageId;
  if (!firstKeptMessageId) {
    return 0;
  }

  const existingBoundary = conversation.messages.findIndex(
    (message) => message.id === firstKeptMessageId,
  );
  return existingBoundary >= 0 ? existingBoundary : 0;
}

function findFirstKeptIndex(
  messages: ConversationEvent[],
  startIndex: number,
  options: { keepRecentTokens: number; force: boolean },
): number | undefined {
  let accumulatedTokens = 0;

  for (let index = messages.length - 1; index > startIndex; index -= 1) {
    accumulatedTokens += estimateMessageTokens(messages[index]!);
    if (accumulatedTokens < options.keepRecentTokens) {
      continue;
    }

    const turnStart = findTurnStartAtOrBefore(messages, index, startIndex);
    return turnStart !== undefined && turnStart > startIndex ? turnStart : undefined;
  }

  if (!options.force) {
    return undefined;
  }

  return findLastTurnStartAfter(messages, startIndex);
}

function findTurnStartAtOrBefore(
  messages: ConversationEvent[],
  index: number,
  startIndex: number,
): number | undefined {
  for (let cursor = index; cursor > startIndex; cursor -= 1) {
    if (messages[cursor]?.role === "user") {
      return cursor;
    }
  }

  return undefined;
}

function findLastTurnStartAfter(
  messages: ConversationEvent[],
  startIndex: number,
): number | undefined {
  for (let index = messages.length - 1; index > startIndex; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return undefined;
}

function createCompactionSummaryMessage(conversation: ConversationContext): ConversationEvent {
  const compaction = conversation.state.compaction!;
  const timestamp = Date.parse(compaction.createdAt);
  return {
    kind: "message",
    id: `compaction:${compaction.sequence}:summary`,
    role: "user",
    content: [
      "The previous conversation has been compacted. Use this context checkpoint as authoritative background, then continue from the recent messages that follow.",
      "",
      "<context_checkpoint>",
      compaction.summary.trim(),
      "</context_checkpoint>",
    ].join("\n"),
    timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
    createdAt: compaction.createdAt,
  };
}

function stripPreCompactionResponseId(
  message: ConversationEvent,
  compactedAt: string,
): ConversationEvent {
  if (message.role !== "assistant" || !message.responseId) {
    return message;
  }

  const messageTime = Date.parse(message.createdAt);
  const compactionTime = Date.parse(compactedAt);
  if (Number.isNaN(messageTime) || Number.isNaN(compactionTime) || messageTime > compactionTime) {
    return message;
  }

  const withoutResponseId = { ...message };
  delete withoutResponseId.responseId;
  return withoutResponseId;
}

function estimateMessageTokens(message: ConversationEvent): number {
  if (message.role === "user") {
    return estimateContentTokens(message.content);
  }

  if (message.role === "toolResult") {
    return estimateContentTokens(message.content) + estimateTextTokens(message.toolName);
  }

  let chars = message.model.length + message.provider.length + message.stopReason.length;
  for (const block of message.content) {
    if (block.type === "text") {
      chars += block.text.length;
      continue;
    }

    if (block.type === "thinking") {
      chars += block.thinking.length;
      continue;
    }

    chars += block.name.length + JSON.stringify(block.arguments ?? {}).length;
  }

  return Math.ceil(chars / 4);
}

function estimateContentTokens(content: SummaryContent): number {
  if (typeof content === "string") {
    return estimateTextTokens(content);
  }

  let tokens = 0;
  for (const block of content) {
    if (block.type === "text") {
      tokens += estimateTextTokens(block.text);
      continue;
    }

    tokens += 1_200;
  }

  return tokens;
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function renderSummaryMessage(message: ConversationEvent, maxBlockChars: number): string {
  if (message.role === "user") {
    return [
      `[${message.createdAt}] User`,
      renderSummaryContent(message.content, maxBlockChars),
    ].join("\n");
  }

  if (message.role === "toolResult") {
    return [
      `[${message.createdAt}] Tool result: ${message.toolName}${message.isError ? " (error)" : ""}`,
      renderSummaryContent(message.content, maxBlockChars),
    ].join("\n");
  }

  return renderAssistantSummaryMessage(message, maxBlockChars);
}

function renderAssistantSummaryMessage(
  message: ConversationAssistantMessage,
  maxBlockChars: number,
): string {
  const lines = [
    `[${message.createdAt}] Assistant (${message.provider}/${message.model}, stop: ${message.stopReason})`,
  ];

  for (const block of message.content) {
    if (block.type === "text") {
      lines.push(truncateText(block.text, maxBlockChars));
      continue;
    }

    if (block.type === "toolCall") {
      lines.push(`Tool call: ${block.name} ${truncateText(JSON.stringify(block.arguments ?? {}), maxBlockChars)}`);
      continue;
    }

    lines.push("[Internal thinking omitted]");
  }

  return lines.join("\n");
}

function renderSummaryContent(
  content: SummaryContent,
  maxBlockChars: number,
): string {
  if (typeof content === "string") {
    return truncateText(content, maxBlockChars);
  }

  return content.map((block) => {
    if (block.type === "text") {
      return truncateText(block.text, maxBlockChars);
    }

    return `[Image content omitted: ${block.mimeType}]`;
  }).join("\n");
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}
