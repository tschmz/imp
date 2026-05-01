import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { renderInlineCode } from "./renderers.js";
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
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const create = dependencies.conversationStore.createForAgent ?? dependencies.conversationStore.create;

    const created = await create(message.conversation, {
      agentId,
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
      agentId,
    });

    return {
      conversation: message.conversation,
      text: [
        "**New session**",
        `Session: ${title ?? "untitled"}`,
        `Agent: \`${agentId}\``,
        `ID: ${renderInlineCode(created.state.conversation.sessionId)}`,
        "",
        "Previous sessions: `/history`",
      ].join("\n"),
    };
  },
};
