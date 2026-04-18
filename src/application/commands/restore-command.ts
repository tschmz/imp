import { formatTimestamp, renderRestoreUsage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { pickRestoreBackup } from "./utils.js";

export const restoreCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "restore",
    description: "Restore a session from history",
    usage: "/restore <n>",
    helpDescription: "Restore a session from /history. 1 is the most recent previous session",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "restore";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const backups = dependencies.conversationStore.listBackupsForAgent
      ? await dependencies.conversationStore.listBackupsForAgent(agentId)
      : await dependencies.conversationStore.listBackups(message.conversation);
    const selectedBackup = pickRestoreBackup(backups, message.commandArgs);
    if (!selectedBackup) {
      return {
        conversation: message.conversation,
        text: renderRestoreUsage(backups.length),
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

    await logger?.debug("restored conversation via inbound command", {
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
        `Restored session ${backups.indexOf(selectedBackup) + 1}: ${title && title.length > 0 ? title : "untitled"}`,
        `Agent: ${selectedBackup.agentId}`,
        `Messages: ${selectedBackup.messageCount}`,
        `Updated: ${formatTimestamp(selectedBackup.updatedAt)}`,
      ].join("\n"),
    };
  },
};
