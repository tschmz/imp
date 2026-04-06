import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import type { ConversationBackupSummary } from "../../storage/types.js";

export function renderStatusMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
): string {
  if (!conversation) {
    return [
      "No active conversation.",
      `Restore points available: ${backups.length}`,
      backups.length > 0 ? "Use /history to inspect them or /restore <n> to recover one." : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Current conversation:",
    `Title: ${conversation.state.title ?? "not set"}`,
    `Agent: ${conversation.state.agentId}`,
    `Messages: ${conversation.messages.length}`,
    `Created: ${conversation.state.createdAt}`,
    `Updated: ${conversation.state.updatedAt}`,
    `Working directory: ${conversation.state.workingDirectory ?? "not set"}`,
    `Restore points available: ${backups.length}`,
  ].join("\n");
}

export function renderHistoryMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
): string {
  const lines = [
    "Conversation history:",
    conversation
      ? `Current: ${conversation.state.title ?? "untitled"} with ${conversation.messages.length} messages, updated ${conversation.state.updatedAt}`
      : "Current: no active conversation",
  ];

  if (backups.length === 0) {
    lines.push("Backups: none");
    return lines.join("\n");
  }

  lines.push("Backups:");
  for (const [index, backup] of backups.entries()) {
    lines.push(
      `${index + 1}. ${backup.updatedAt} | ${backup.messageCount} messages | agent ${backup.agentId}`,
    );
  }
  lines.push("Use /restore <n> to restore one of these backups.");
  return lines.join("\n");
}

export function renderRestoreUsage(backupCount: number): string {
  if (backupCount === 0) {
    return "No restore points are available yet. Use /new first, then /history to inspect backups.";
  }

  return ["Usage: /restore <n>", "Choose a numbered restore point from /history.", "Example: /restore 1"].join("\n");
}

export function renderAgentMessage(
  agent: AgentDefinition,
  options: {
    currentAgentId: string;
    availableAgentIds: string[];
  },
): string {
  return [
    "Agent details:",
    `Current: ${options.currentAgentId}`,
    `Name: ${agent.name}`,
    `Provider: ${agent.model.provider}`,
    `Model: ${agent.model.modelId}`,
    `System prompt file: ${agent.systemPromptFile ?? "inline"}`,
    `Auth file: ${agent.authFile ?? "not set"}`,
    `Context files: ${agent.context?.files?.join(", ") ?? "none"}`,
    `Tools: ${agent.tools.length > 0 ? agent.tools.join(", ") : "none"}`,
    `Available: ${options.availableAgentIds.join(", ")}`,
  ].join("\n");
}

export function renderConversationExport(conversation: ConversationContext): string {
  const lines = [
    "Conversation export",
    `Title: ${conversation.state.title ?? "untitled"}`,
    `Agent: ${conversation.state.agentId}`,
    `Created: ${conversation.state.createdAt}`,
    `Updated: ${conversation.state.updatedAt}`,
    "",
  ];

  if (conversation.messages.length === 0) {
    lines.push("No messages.");
    return lines.join("\n");
  }

  for (const message of conversation.messages) {
    lines.push(`[${message.createdAt}] ${message.role}`);
    lines.push(message.text);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
