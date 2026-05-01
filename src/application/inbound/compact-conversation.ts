import { compactConversation } from "../conversation-compaction.js";
import {
  DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
  DEFAULT_COMPACTION_RESERVE_TOKENS,
  estimateConversationTokens,
  shouldCompactConversation,
} from "../../domain/conversation-compaction.js";
import { defaultResolveModel, resolveConfiguredModel } from "../../runtime/model-resolution.js";
import { toUserConversationMessage } from "./incoming-message-event.js";
import type { InboundProcessingContext } from "./types.js";

export async function compactConversationIfNeeded(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent || !context.conversation) {
    return;
  }

  const model = resolveConfiguredModel(
    context.agent.model,
    context.dependencies.resolveModel ?? defaultResolveModel,
  );
  if (!model) {
    return;
  }

  const incomingMessage = toUserConversationMessage(context.message);
  const projectedConversation = {
    ...context.conversation,
    messages: [...context.conversation.messages, incomingMessage],
  };
  if (!shouldCompactConversation(projectedConversation, model.contextWindow)) {
    return;
  }

  try {
    const incomingTokens = estimateConversationTokens([incomingMessage]);
    const result = await compactConversation({
      conversation: context.conversation,
      agent: context.agent,
      message: context.message,
      engine: context.dependencies.engine,
      conversationStore: context.dependencies.conversationStore,
      runtimeInfo: context.dependencies.runtimeInfo,
      model,
      force: false,
      keepRecentTokens: resolveAutomaticKeepRecentTokens(model.contextWindow, incomingTokens),
    });

    if (result) {
      context.conversation = result.conversation;
    }
  } catch (error) {
    await context.dependencies.logger?.error("automatic conversation compaction failed", {
      endpointId: context.message.endpointId,
      transport: context.message.conversation.transport,
      conversationId: context.message.conversation.externalId,
      messageId: context.message.messageId,
      correlationId: context.message.correlationId,
      agentId: context.agent.id,
      errorType: error instanceof Error ? error.name : typeof error,
    }, error);
  }
}

function resolveAutomaticKeepRecentTokens(contextWindow: number, incomingTokens: number): number {
  const defaultKeepRecentTokens = Math.min(
    DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
    Math.max(2_000, Math.floor(contextWindow * 0.2)),
  );
  const availableBeforeIncomingMessage =
    contextWindow - incomingTokens - DEFAULT_COMPACTION_RESERVE_TOKENS;

  if (!Number.isFinite(availableBeforeIncomingMessage) || availableBeforeIncomingMessage <= 0) {
    return 0;
  }

  return Math.min(defaultKeepRecentTokens, Math.floor(availableBeforeIncomingMessage));
}
