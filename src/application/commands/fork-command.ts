import { formatCount } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export const forkCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "fork",
    description: "Fork the current session",
    usage: "/fork [title]",
    helpDescription: "Fork the current session",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "fork";
  },
  async handle({ message, dependencies, logger }: InboundCommandContext) {
    const title = normalizeCommandArgument(message.commandArgs);
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;

    const forked = dependencies.conversationStore.forkActiveForAgent
      ? await dependencies.conversationStore.forkActiveForAgent(message.conversation, {
        agentId,
        now: message.receivedAt,
        ...(title ? { title } : {}),
      })
      : await forkActiveSessionFallback({ message, dependencies, agentId, title });

    if (!forked) {
      return {
        conversation: message.conversation,
        text: ["**Fork**", "No active session to fork."].join("\n"),
      };
    }

    await logger?.debug("forked session via inbound command", {
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
        "**Fork**",
        `Session: ${forked.state.title ?? "untitled"}`,
        `Messages: ${formatCount(forked.messages.length)}`,
      ].join("\n"),
    };
  },
};

async function forkActiveSessionFallback({
  message,
  dependencies,
  agentId,
  title,
}: Pick<InboundCommandContext, "message" | "dependencies"> & { agentId: string; title?: string }) {
  const active =
    await dependencies.conversationStore.getActiveForAgent?.(agentId) ??
    await dependencies.conversationStore.get(message.conversation);
  if (!active) {
    return undefined;
  }

  const create = dependencies.conversationStore.createForAgent ?? dependencies.conversationStore.create;
  const created = await create(message.conversation, {
    agentId,
    now: message.receivedAt,
    ...(title ?? active.state.title ? { title: title ?? active.state.title } : {}),
  });
  const forked = {
    state: {
      conversation: created.state.conversation,
      agentId: active.state.agentId,
      ...(active.state.kind ? { kind: active.state.kind } : {}),
      ...(active.state.metadata ? { metadata: active.state.metadata } : {}),
      ...(created.state.title ? { title: created.state.title } : {}),
      ...(active.state.workingDirectory ? { workingDirectory: active.state.workingDirectory } : {}),
      ...(active.state.compaction ? { compaction: active.state.compaction } : {}),
      createdAt: message.receivedAt,
      updatedAt: message.receivedAt,
      version: 1,
    },
    messages: active.messages,
  };

  await dependencies.conversationStore.put(forked);
  return forked;
}
