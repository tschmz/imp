import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export const newCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "new",
    description: "Start a new session",
    usage: "/new [title]",
    helpDescription: "Start a new session. The previous one stays available in /history",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "new";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const title = normalizeCommandArgument(message.commandArgs);

    await dependencies.conversationStore.create(message.conversation, {
      agentId: dependencies.defaultAgentId,
      now: message.receivedAt,
      ...(title ? { title } : {}),
    });
    await logger?.debug("created new session via inbound command", {
      endpointId: message.endpointId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      command: message.command,
      agentId: dependencies.defaultAgentId,
    });

    return {
      conversation: message.conversation,
      text: title
        ? `Started a fresh session titled "${title}". Your previous session is still available in /history.`
        : "Started a fresh session. Your previous session is still available in /history.",
    };
  },
};
