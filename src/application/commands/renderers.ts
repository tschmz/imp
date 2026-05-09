import type { Usage } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "../../domain/agent.js";
import {
  buildCompactedConversationMessages,
  estimateConversationTokens,
} from "../../domain/conversation-compaction.js";
import type {
  ConversationAssistantMessage,
  ConversationContext,
} from "../../domain/conversation.js";
import type { ModelResolver } from "../../runtime/model-resolution.js";
import type { ConversationBackupSummary } from "../../storage/types.js";

export function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function renderHistoryEntryLabel(title: string | undefined): string {
  return title ?? "untitled";
}

function aggregateLlmUsage(conversation: ConversationContext): Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens"> {
  return conversation.messages.reduce(
    (total, message) => {
      if (message.role !== "assistant" || !message.usage) {
        return total;
      }

      total.input += message.usage.input;
      total.output += message.usage.output;
      total.cacheRead += message.usage.cacheRead;
      total.cacheWrite += message.usage.cacheWrite;
      total.totalTokens += message.usage.totalTokens;
      return total;
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  );
}

export function formatCount(value: number | undefined): string {
  return value === undefined ? "unknown" : new Intl.NumberFormat("en-US").format(value);
}

function formatCountLabel(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

function formatContextUsage(contextTokens: number, contextWindow: number | undefined): string {
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return "unknown of unknown";
  }

  const usedTokens = Math.max(0, contextTokens);
  const availableTokens = Math.max(0, contextWindow - usedTokens);
  return [
    `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((usedTokens / contextWindow) * 100)}%`,
    `${formatCount(usedTokens)} used`,
    `${formatCount(availableTokens)} available`,
    `of ${formatCount(contextWindow)}`,
  ].join(" · ");
}

function countUserTurns(conversation: ConversationContext): number {
  return conversation.messages.filter((message) => message.role === "user").length;
}

function getLastAssistantMessage(
  conversation: ConversationContext,
): ConversationAssistantMessage | undefined {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message?.role === "assistant") {
      return message;
    }
  }

  return undefined;
}

function renderMarkdownValue(value: string | number | undefined): string {
  return value === undefined || value === "" ? "not set" : String(value);
}

export function renderInlineCode(value: string | undefined): string {
  const rendered = renderMarkdownValue(value);
  return rendered === "not set" ? rendered : `\`${rendered}\``;
}

export function renderCodeCsv(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "none";
}

function renderSessionLabel(title: string | undefined): string {
  const label = title?.trim();
  return label && label.length > 0 ? label : "untitled";
}

function renderLastLlmTurnSummary(
  conversation: ConversationContext,
  agent: AgentDefinition | undefined,
  resolveModel: ModelResolver,
): {
  contextUsage: string;
  lastTurn: string;
} {
  const lastAssistantMessage = getLastAssistantMessage(conversation);
  const contextTokens = estimateConversationTokens(buildCompactedConversationMessages(conversation));

  if (!lastAssistantMessage) {
    const configuredModel = agent
      ? resolveModel(agent.model.provider, agent.model.modelId)
      : undefined;
    return {
      contextUsage: `${formatContextUsage(contextTokens, configuredModel?.contextWindow)} estimated`,
      lastTurn: "none yet",
    };
  }

  const provider = lastAssistantMessage.provider ?? "unknown";
  const modelId = lastAssistantMessage.model ?? "unknown";
  const model = resolveModel(provider, modelId);
  return {
    contextUsage: `${formatContextUsage(contextTokens, model?.contextWindow)} estimated`,
    lastTurn: [
      `\`${provider}/${modelId}\``,
      `${formatCount(lastAssistantMessage.usage.totalTokens)} tokens`,
      `max ${formatCount(model?.maxTokens)}`,
    ].join(" · "),
  };
}

export function renderStatusMessage(
  conversation: ConversationContext | undefined,
  agent: AgentDefinition | undefined,
  resolveModel: ModelResolver,
): string {
  if (!conversation) {
    return [
      "**Status**",
      "No active session.",
    ].join("\n");
  }

  const llmUsage = aggregateLlmUsage(conversation);
  const llmTurn = renderLastLlmTurnSummary(conversation, agent, resolveModel);
  const runStatus = conversation.state.run?.status ?? "idle";

  return [
    "**Status**",
    `Session: ${renderSessionLabel(conversation.state.title)}`,
    `State: ${runStatus}`,
    `Turns/events: ${formatCount(countUserTurns(conversation))} / ${formatCount(conversation.messages.length)}`,
    ...(conversation.state.run?.error ? [`Error: ${conversation.state.run.error}`] : []),
    `Context: ${llmTurn.contextUsage}`,
    `Tokens: ${formatCount(llmUsage.totalTokens)} total · ${formatCount(llmUsage.input)} in · ${formatCount(llmUsage.output)} out · ${formatCount(llmUsage.cacheRead)} cache read · ${formatCount(llmUsage.cacheWrite)} cache write`,
    `Last turn: ${llmTurn.lastTurn}`,
  ].join("\n");
}

export function renderHistoryMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
): string {
  const lines = ["**History**"];

  if (conversation) {
    lines.push(
      `Current: ${renderHistoryEntryLabel(conversation.state.title)} (${formatCountLabel(countUserTurns(conversation), "turn")}, ${formatCountLabel(conversation.messages.length, "event")})`,
    );
  } else {
    lines.push("Current: none");
  }

  if (backups.length === 0) {
    lines.push("");
    lines.push("No previous sessions.");
    return lines.join("\n");
  }

  lines.push("");
  for (const [index, backup] of backups.entries()) {
    lines.push(
      `${index + 1}. ${renderHistoryEntryLabel(backup.title)} (${formatCountLabel(backup.messageCount, "event")})`,
    );
  }

  return lines.join("\n");
}

export function renderResumeUsage(backupCount: number): string {
  if (backupCount === 0) {
    return ["**Resume**", "No previous sessions."].join("\n");
  }

  return ["**Resume**", "Usage: `/resume <n>`"].join("\n");
}

export function renderAgentMessage(options: {
  currentAgentId: string;
  availableAgentIds: string[];
}): string {
  return [
    "**Agent**",
    `Selected: \`${options.currentAgentId}\``,
    `Available: ${renderCodeCsv(options.availableAgentIds)}`,
  ].join("\n");
}

export function renderAgentSwitchMessage(
  agent: AgentDefinition,
): string {
  return [
    "**Agent**",
    `Selected: \`${agent.id}\``,
  ].join("\n");
}

export function renderUnknownAgentMessage(
  requestedAgentId: string,
  availableAgentIds: string[],
  options: { configuredButNotLoaded?: boolean } = {},
): string {
  if (options.configuredButNotLoaded) {
    return [
      "**Agent**",
      `\`${requestedAgentId}\` is configured but not loaded.`,
      `Available: ${renderCodeCsv(availableAgentIds)}`,
    ].join("\n");
  }

  return [
    "**Agent**",
    `Unknown: \`${requestedAgentId}\``,
    `Available: ${renderCodeCsv(availableAgentIds)}`,
  ].join("\n");
}
