import { renderRestoreUsage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { pickRestoreBackup } from "./utils.js";

export const restoreCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "restore",
    description: "Restore a backup with /restore <n>",
    usage: "/restore <n>",
  },
  canHandle(command) {
    return command === "restore";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const backups = await dependencies.conversationStore.listBackups(message.conversation);
    const selectedBackup = pickRestoreBackup(backups, message.commandArgs);
    if (!selectedBackup) {
      return {
        conversation: message.conversation,
        text: renderRestoreUsage(backups.length),
      };
    }

    const restored = await dependencies.conversationStore.restore(message.conversation, selectedBackup.id);
    if (!restored) {
      return {
        conversation: message.conversation,
        text: "That restore point is no longer available. Run /history and try again.",
      };
    }

    await logger?.debug("restored conversation via inbound command", {
      botId: message.botId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      command: message.command,
      backupId: selectedBackup.id,
      agentId: selectedBackup.agentId,
    });
    return {
      conversation: message.conversation,
      text: [
        `Restored backup ${backups.indexOf(selectedBackup) + 1}.`,
        "The previously active conversation was backed up before the restore.",
        `Agent: ${selectedBackup.agentId}`,
        `Messages: ${selectedBackup.messageCount}`,
        `Updated: ${selectedBackup.updatedAt}`,
      ].join("\n"),
    };
  },
};
