import type { Usage } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../../domain/agent.js";
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

function resolveDisplayedWorkingDirectory(
  conversation: ConversationContext | undefined,
  agent: AgentDefinition | undefined,
): string {
  return conversation?.state.workingDirectory ?? agent?.workspace?.cwd ?? "not set";
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

function formatCount(value: number | undefined): string {
  return value === undefined ? "unknown" : new Intl.NumberFormat("en-US").format(value);
}

function formatContextUsage(inputTokens: number, contextWindow: number | undefined): string {
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return "unknown";
  }

  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((inputTokens / contextWindow) * 100)}%`;
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

function renderLastLlmTurn(
  conversation: ConversationContext,
  resolveModel: ModelResolver,
): string[] {
  const lastAssistantMessage = getLastAssistantMessage(conversation);
  if (!lastAssistantMessage) {
    return ["**Last LLM turn**", "No LLM turn recorded yet."];
  }

  const model = resolveModel(lastAssistantMessage.provider, lastAssistantMessage.model);
  return [
    "**Last LLM turn**",
    `Model: ${lastAssistantMessage.provider}/${lastAssistantMessage.model}`,
    `Total: ${formatCount(lastAssistantMessage.usage.totalTokens)}`,
    `Input: ${formatCount(lastAssistantMessage.usage.input)}`,
    `Output: ${formatCount(lastAssistantMessage.usage.output)}`,
    `Cache read: ${formatCount(lastAssistantMessage.usage.cacheRead)}`,
    `Cache write: ${formatCount(lastAssistantMessage.usage.cacheWrite)}`,
    "",
    "**Model limits**",
    `Context window: ${formatCount(model?.contextWindow)}`,
    `Context usage: ${formatContextUsage(lastAssistantMessage.usage.input, model?.contextWindow)}`,
    `Max tokens: ${formatCount(model?.maxTokens)}`,
  ];
}

export function renderStatusMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
  agent: AgentDefinition | undefined,
  resolveModel: ModelResolver,
): string {
  if (!conversation) {
    return [
      "No active session.",
      `Sessions in history: ${backups.length}`,
      backups.length > 0 ? "Use /history to inspect them or /resume <n> to switch to one." : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const llmUsage = aggregateLlmUsage(conversation);

  return [
    "**Active session**",
    `Title: ${conversation.state.title ?? "not set"}`,
    `Agent: ${conversation.state.agentId}`,
    `Entries: ${formatCount(conversation.messages.length)}`,
    `Created: ${formatTimestamp(conversation.state.createdAt)}`,
    `Updated: ${formatTimestamp(conversation.state.updatedAt)}`,
    `Working directory: ${resolveDisplayedWorkingDirectory(conversation, agent)}`,
    `Sessions in history: ${formatCount(backups.length)}`,
    "",
    "**Session usage**",
    `Total: ${formatCount(llmUsage.totalTokens)}`,
    `Input: ${formatCount(llmUsage.input)}`,
    `Output: ${formatCount(llmUsage.output)}`,
    `Cache read: ${formatCount(llmUsage.cacheRead)}`,
    `Cache write: ${formatCount(llmUsage.cacheWrite)}`,
    "",
    ...renderLastLlmTurn(conversation, resolveModel),
  ].join("\n");
}

export function renderHistoryMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
  agent: AgentDefinition | undefined,
): string {
  const lines = ["Session history:", ""];

  if (conversation) {
    lines.push("Current:");
    lines.push(
      `- ${renderHistoryEntryLabel(conversation.state.title)} · agent ${conversation.state.agentId} · ${conversation.messages.length} entr${conversation.messages.length === 1 ? "y" : "ies"} · updated ${formatTimestamp(conversation.state.updatedAt)}`,
    );
    lines.push(`- wd ${resolveDisplayedWorkingDirectory(conversation, agent)}`);
  } else {
    lines.push("Current:");
    lines.push("- none");
  }

  lines.push("");
  lines.push("Previous:");

  if (backups.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const [index, backup] of backups.entries()) {
    lines.push(
      `${index + 1}. ${renderHistoryEntryLabel(backup.title)} · agent ${backup.agentId} · ${backup.messageCount} entr${backup.messageCount === 1 ? "y" : "ies"} · ${formatTimestamp(backup.updatedAt)}`,
    );
  }

  lines.push("");
  lines.push("Use /resume <n> to switch sessions.");
  return lines.join("\n");
}

export function renderResumeUsage(backupCount: number): string {
  if (backupCount === 0) {
    return "No previous sessions are available yet. Use /new to start another session, then /history to inspect earlier ones.";
  }

  return ["Usage: /resume <n>", "Choose a numbered session from /history.", "Example: /resume 1"].join(
    "\n",
  );
}

export function renderAgentMessage(
  agent: AgentDefinition,
  options: {
    currentAgentId: string;
    availableAgentIds: string[];
  },
): string {
  const basePrompt = agent.prompt.base.file ?? (agent.prompt.base.builtIn ? `built-in:${agent.prompt.base.builtIn}` : "inline");
  const instructionSources = (agent.prompt.instructions ?? []).map((source) =>
    "file" in source ? source.file : "inline",
  );
  const referenceSources = (agent.prompt.references ?? []).map((source) =>
    "file" in source ? source.file : "inline",
  );

  return [
    "Agent details:",
    `Current: ${options.currentAgentId}`,
    `Name: ${agent.name}`,
    `Provider: ${agent.model.provider}`,
    `Model: ${agent.model.modelId}`,
    `Base prompt: ${basePrompt}`,
    `Home: ${agent.home ?? "not set"}`,
    `Auth file: ${agent.model.authFile ?? "not set"}`,
    `API key: ${agent.model.apiKey ? "configured" : "not set"}`,
    `Instructions: ${instructionSources.length > 0 ? instructionSources.join(", ") : "none"}`,
    `References: ${referenceSources.length > 0 ? referenceSources.join(", ") : "none"}`,
    `Workspace: ${agent.workspace?.cwd ?? "not set"}`,
    `Skills: ${agent.skills?.paths.length ? agent.skills.paths.join(", ") : "none"}`,
    `Tools: ${agent.tools.length > 0 ? agent.tools.join(", ") : "none"}`,
    `Available: ${options.availableAgentIds.join(", ")}`,
  ].join("\n");
}
