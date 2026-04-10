import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
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

export function renderStatusMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
  agent: AgentDefinition | undefined,
): string {
  if (!conversation) {
    return [
      "No active session.",
      `Sessions in history: ${backups.length}`,
      backups.length > 0 ? "Use /history to inspect them or /restore <n> to switch to one." : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Active session:",
    `Title: ${conversation.state.title ?? "not set"}`,
    `Agent: ${conversation.state.agentId}`,
    `Entries: ${conversation.messages.length}`,
    `Created: ${formatTimestamp(conversation.state.createdAt)}`,
    `Updated: ${formatTimestamp(conversation.state.updatedAt)}`,
    `Working directory: ${resolveDisplayedWorkingDirectory(conversation, agent)}`,
    `Sessions in history: ${backups.length}`,
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
  lines.push("Use /restore <n> to switch sessions.");
  return lines.join("\n");
}

export function renderRestoreUsage(backupCount: number): string {
  if (backupCount === 0) {
    return "No previous sessions are available yet. Use /new to start another session, then /history to inspect earlier ones.";
  }

  return ["Usage: /restore <n>", "Choose a numbered session from /history.", "Example: /restore 1"].join(
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
  const basePrompt = "file" in agent.prompt.base ? agent.prompt.base.file : "inline";
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
    `Auth file: ${agent.authFile ?? "not set"}`,
    `Instructions: ${instructionSources.length > 0 ? instructionSources.join(", ") : "none"}`,
    `References: ${referenceSources.length > 0 ? referenceSources.join(", ") : "none"}`,
    `Workspace: ${agent.workspace?.cwd ?? "not set"}`,
    `Tools: ${agent.tools.length > 0 ? agent.tools.join(", ") : "none"}`,
    `Available: ${options.availableAgentIds.join(", ")}`,
  ].join("\n");
}

export function renderConversationExport(conversation: ConversationContext): string {
  const lines = [
    "Conversation export",
    `Title: ${conversation.state.title ?? "untitled"}`,
    `Agent: ${conversation.state.agentId}`,
    `Created: ${formatTimestamp(conversation.state.createdAt)}`,
    `Updated: ${formatTimestamp(conversation.state.updatedAt)}`,
    "",
  ];

  if (conversation.messages.length === 0) {
    lines.push("No messages.");
    return lines.join("\n");
  }

  for (const message of conversation.messages) {
    if (message.kind === "tool-call") {
      lines.push(
        `[${message.createdAt}] tool-call ${message.toolCalls.map((toolCall) => toolCall.name).join(", ")}`,
      );
      if (message.text) {
        lines.push(message.text);
      }
      for (const toolCall of message.toolCalls) {
        lines.push(`id: ${toolCall.id}`);
        lines.push(`args: ${JSON.stringify(toolCall.arguments)}`);
      }
      lines.push("");
      continue;
    }

    if (message.kind === "tool-result") {
      lines.push(
        `[${message.createdAt}] tool-result ${message.toolName} (${message.isError ? "error" : "ok"})`,
      );
      lines.push(`toolCallId: ${message.toolCallId}`);
      if (message.content.length > 0) {
        lines.push(
          message.content
            .map((content) =>
              content.type === "text"
                ? content.text
                : `[image ${content.mimeType}, ${content.data.length} bytes base64]`,
            )
            .join("\n"),
        );
      }
      if (message.details !== undefined) {
        lines.push(`details: ${JSON.stringify(message.details)}`);
      }
      lines.push("");
      continue;
    }

    lines.push(`[${message.createdAt}] ${message.role}`);
    lines.push(message.text);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
