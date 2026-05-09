import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const deleteCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "delete",
    description: "Delete the current session",
    helpDescription: "Delete the current session",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "delete";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const deleted = await dependencies.conversationStore.deleteActiveForAgent?.(agentId);

    if (!deleted) {
      return {
        conversation: message.conversation,
        text: ["**Delete**", "No active session to delete."].join("\n"),
      };
    }

    await logger?.debug("deleted session via inbound command", {
      endpointId: message.endpointId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      command: message.command,
      agentId,
    });

    return {
      conversation: message.conversation,
      text: [
        "**Delete**",
        `Deleted: ${deleted.state.title ?? "untitled"}`,
      ].join("\n"),
    };
  },
};
