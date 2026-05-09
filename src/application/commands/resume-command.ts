import { toLastVisibleTurnReplayItems } from "../conversation-replay.js";
import { renderResumeUsage } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { pickResumeBackup } from "./utils.js";

export const resumeCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "resume",
    description: "Resume a session from history",
    usage: "/resume <n>",
    helpDescription: "Resume a previous session",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "resume";
  },
  async handle(context: InboundCommandContext) {
    return handleResumeCommand(context, context.message.commandArgs);
  },
};

export const previousCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "previous",
    description: "Resume the most recent previous session",
    helpDescription: "Resume the previous session",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "previous";
  },
  async handle(context: InboundCommandContext) {
    return handleResumeCommand(context, "1");
  },
};

async function handleResumeCommand(
  { message, dependencies, logger }: InboundCommandContext,
  commandArgs: string | undefined,
) {
  const agentId =
    await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
    dependencies.defaultAgentId;
  const backups = dependencies.conversationStore.listBackupsForAgent
    ? await dependencies.conversationStore.listBackupsForAgent(agentId)
    : await dependencies.conversationStore.listBackups(message.conversation);
  const selectedBackup = pickResumeBackup(backups, commandArgs);
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
      text: ["**Resume**", "That session is no longer available."].join("\n"),
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
      "**Resume**",
      `Session: ${title && title.length > 0 ? title : "untitled"} (#${backups.indexOf(selectedBackup) + 1})`,
    ].join("\n"),
    ...(resumedConversation
      ? { replay: toLastVisibleTurnReplayItems(resumedConversation) }
      : {}),
  };
}
