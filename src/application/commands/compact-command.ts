import { compactConversation } from "../conversation-compaction.js";
import { defaultResolveModel, resolveConfiguredModel } from "../../runtime/model-resolution.js";
import { formatCount } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const compactCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "compact",
    description: "Compact old context in the current session",
    usage: "/compact [focus]",
    helpDescription: "Summarize old context in the current session while keeping recent messages",
    helpGroup: "Context",
  },
  canHandle(command) {
    return command === "compact";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const explicitSession = message.conversation.sessionId
      ? await dependencies.conversationStore.get(message.conversation)
      : undefined;
    const conversation =
      explicitSession ??
      await dependencies.conversationStore.getActiveForAgent?.(agentId) ??
      await dependencies.conversationStore.get(message.conversation);
    if (!conversation) {
      return {
        conversation: message.conversation,
        text: ["**Compact**", "No active session to compact."].join("\n"),
      };
    }

    const agent = dependencies.agentRegistry.get(conversation.state.agentId);
    if (!agent) {
      return {
        conversation: message.conversation,
        text: [
          "**Compact**",
          `Cannot compact because agent \`${conversation.state.agentId}\` is not available.`,
        ].join("\n"),
      };
    }

    const model = resolveConfiguredModel(
      agent.model,
      dependencies.resolveModel ?? defaultResolveModel,
    );
    const result = await compactConversation({
      conversation,
      agent,
      message,
      engine: dependencies.engine,
      conversationStore: dependencies.conversationStore,
      runtimeInfo: dependencies.runtimeInfo,
      ...(model ? { model } : {}),
      customInstructions: message.commandArgs,
      force: true,
    });

    if (!result) {
      return {
        conversation: message.conversation,
        text: ["**Compact**", "Not enough previous context to compact yet."].join("\n"),
      };
    }

    return {
      conversation: message.conversation,
      text: [
        "**Compact**",
        `Context compacted: ${formatCount(result.compaction.messageCountSummarized)} summarized, ${formatCount(result.compaction.messageCountKept)} kept`,
        `Tokens: ${formatCount(result.compaction.tokensBefore)} -> ${formatCount(result.compaction.tokensAfter)}`,
      ].join("\n"),
    };
  },
};
