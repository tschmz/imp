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
  return conversation?.state.workingDirectory ?? agent?.workspace?.cwd ?? agent?.home ?? "not set";
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

function renderInlineCode(value: string | undefined): string {
  const rendered = renderMarkdownValue(value);
  return rendered === "not set" ? rendered : `\`${rendered}\``;
}

function renderCsv(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function renderCodeCsv(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "none";
}

function renderPromptSource(source: AgentDefinition["prompt"]["base"]): string {
  return source.file ?? (source.builtIn ? `built-in:${source.builtIn}` : "inline");
}

function renderLastLlmTurn(
  conversation: ConversationContext,
  resolveModel: ModelResolver,
): string[] {
  const lastAssistantMessage = getLastAssistantMessage(conversation);
  if (!lastAssistantMessage) {
    return ["## Last LLM turn", "No LLM turn recorded yet."];
  }

  const model = resolveModel(lastAssistantMessage.provider, lastAssistantMessage.model);
  return [
    "## Last LLM turn",
    `- **Model:** \`${lastAssistantMessage.provider}/${lastAssistantMessage.model}\``,
    `- **Tokens:** ${formatCount(lastAssistantMessage.usage.totalTokens)} total · ${formatCount(lastAssistantMessage.usage.input)} input · ${formatCount(lastAssistantMessage.usage.output)} output`,
    `- **Cache:** ${formatCount(lastAssistantMessage.usage.cacheRead)} read · ${formatCount(lastAssistantMessage.usage.cacheWrite)} write`,
    `- **Context:** ${formatContextUsage(lastAssistantMessage.usage.input, model?.contextWindow)} of ${formatCount(model?.contextWindow)}`,
    `- **Max tokens:** ${formatCount(model?.maxTokens)}`,
  ];
}

export function renderStatusMessage(
  conversation: ConversationContext | undefined,
  agent: AgentDefinition | undefined,
  resolveModel: ModelResolver,
): string {
  if (!conversation) {
    return [
      "# Status",
      "No active session.",
      "",
      "Use `/new` to start a session or `/history` to inspect previous sessions.",
    ].join("\n");
  }

  const llmUsage = aggregateLlmUsage(conversation);

  return [
    "# Status",
    "",
    "## Session",
    `- **Title:** ${renderMarkdownValue(conversation.state.title)}`,
    `- **Agent:** \`${conversation.state.agentId}\``,
    `- **Turns:** ${formatCount(countUserTurns(conversation))}`,
    `- **Events:** ${formatCount(conversation.messages.length)}`,
    `- **Created:** ${formatTimestamp(conversation.state.createdAt)}`,
    `- **Updated:** ${formatTimestamp(conversation.state.updatedAt)}`,
    `- **Working directory:** ${renderInlineCode(resolveDisplayedWorkingDirectory(conversation, agent))}`,
    "",
    "## Usage",
    `- **Tokens:** ${formatCount(llmUsage.totalTokens)} total · ${formatCount(llmUsage.input)} input · ${formatCount(llmUsage.output)} output`,
    `- **Cache:** ${formatCount(llmUsage.cacheRead)} read · ${formatCount(llmUsage.cacheWrite)} write`,
    "",
    ...renderLastLlmTurn(conversation, resolveModel),
  ].join("\n");
}

export function renderHistoryMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
  agent: AgentDefinition | undefined,
): string {
  const lines = ["# History", "", "## Current session"];

  if (conversation) {
    lines.push(
      `- **Title:** ${renderMarkdownValue(renderHistoryEntryLabel(conversation.state.title))}`,
      `- **Agent:** \`${conversation.state.agentId}\``,
      `- **Turns:** ${formatCount(countUserTurns(conversation))}`,
      `- **Events:** ${formatCount(conversation.messages.length)}`,
      `- **Updated:** ${formatTimestamp(conversation.state.updatedAt)}`,
      `- **Working directory:** ${renderInlineCode(resolveDisplayedWorkingDirectory(conversation, agent))}`,
    );
  } else {
    lines.push("No active session.");
  }

  lines.push("", "## Previous sessions");

  if (backups.length === 0) {
    lines.push("No previous sessions.");
    return lines.join("\n");
  }

  for (const [index, backup] of backups.entries()) {
    lines.push(
      `${index + 1}. **${renderHistoryEntryLabel(backup.title)}** — \`${backup.agentId}\` — ${formatCount(backup.messageCount)} event${backup.messageCount === 1 ? "" : "s"} — updated ${formatTimestamp(backup.updatedAt)}`,
    );
  }

  lines.push("", "Use `/resume <n>` to switch sessions.");
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
  const basePrompt = renderPromptSource(agent.prompt.base);
  const instructionSources = (agent.prompt.instructions ?? []).map(renderPromptSource);
  const referenceSources = (agent.prompt.references ?? []).map(renderPromptSource);

  return [
    "# Agent",
    "",
    "## Selected",
    `- **ID:** \`${options.currentAgentId}\``,
    `- **Name:** ${agent.name}`,
    `- **Model:** \`${agent.model.provider}/${agent.model.modelId}\``,
    `- **Home:** ${renderInlineCode(agent.home)}`,
    `- **Workspace:** ${renderInlineCode(agent.workspace?.cwd)}`,
    `- **Tools:** ${renderCodeCsv(agent.tools)}`,
    `- **Skills:** ${renderCsv(agent.skills?.paths ?? [])}`,
    "",
    "## Prompt",
    `- **Base:** ${renderInlineCode(basePrompt)}`,
    `- **Instructions:** ${renderCsv(instructionSources)}`,
    `- **References:** ${renderCsv(referenceSources)}`,
    "",
    "## Credentials",
    `- **Auth file:** ${renderInlineCode(agent.model.authFile)}`,
    `- **API key:** ${agent.model.apiKey ? "configured" : "not set"}`,
    "",
    "## Available agents",
    renderCodeCsv(options.availableAgentIds),
  ].join("\n");
}
