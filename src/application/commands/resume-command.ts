import type { ConversationContext, ConversationEvent } from "../../domain/conversation.js";
import type { OutgoingMessageReplayItem } from "../../domain/message.js";
import { formatTimestamp, renderResumeUsage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { pickResumeBackup } from "./utils.js";

export const resumeCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "resume",
    description: "Resume a session from history",
    usage: "/resume <n>",
    helpDescription: "Resume a session from /history. 1 is the most recent previous session",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "resume";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const backups = dependencies.conversationStore.listBackupsForAgent
      ? await dependencies.conversationStore.listBackupsForAgent(agentId)
      : await dependencies.conversationStore.listBackups(message.conversation);
    const selectedBackup = pickResumeBackup(backups, message.commandArgs);
    if (!selectedBackup) {
      return {
        conversation: message.conversation,
        text: renderResumeUsage(backups.length),
      };
    }

    const restored = dependencies.conversationStore.restoreForAgent
      ? await dependencies.conversationStore.restoreForAgent(agentId, selectedBackup.id)
      : await dependencies.conversationStore.restore(message.conversation, selectedBackup.id);
    if (!restored) {
      return {
        conversation: message.conversation,
        text: "That session is no longer available. Run /history and try again.",
      };
    }

    const resumedConversation =
      await dependencies.conversationStore.getActiveForAgent?.(agentId) ??
      await dependencies.conversationStore.get(message.conversation);

    await logger?.debug("resumed conversation via inbound command", {
      endpointId: message.endpointId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      command: message.command,
      backupId: selectedBackup.id,
      agentId: selectedBackup.agentId,
    });
    const title = selectedBackup.title?.trim();

    return {
      conversation: message.conversation,
      text: [
        `Resumed session ${backups.indexOf(selectedBackup) + 1}: ${title && title.length > 0 ? title : "untitled"}`,
        `Agent: ${selectedBackup.agentId}`,
        `Messages: ${selectedBackup.messageCount}`,
        `Updated: ${formatTimestamp(selectedBackup.updatedAt)}`,
      ].join("\n"),
      ...(resumedConversation
        ? { replay: toVisibleReplayItems(resumedConversation) }
        : {}),
    };
  },
};

function toVisibleReplayItems(conversation: ConversationContext): OutgoingMessageReplayItem[] {
  return conversation.messages
    .map(toVisibleReplayItem)
    .filter((item): item is OutgoingMessageReplayItem => item !== undefined);
}

function toVisibleReplayItem(message: ConversationEvent): OutgoingMessageReplayItem | undefined {
  if (message.role === "toolResult") {
    return undefined;
  }

  if (message.role === "user") {
    const text = renderVisibleUserText(message.content);
    return text ? { role: "user", text, createdAt: message.createdAt } : undefined;
  }

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text ? { role: "assistant", text, createdAt: message.createdAt } : undefined;
}

function renderVisibleUserText(content: ConversationEvent["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}
