import { compactConversation } from "../conversation-compaction.js";
import {
  DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
  shouldCompactConversation,
} from "../../domain/conversation-compaction.js";
import { defaultResolveModel, resolveConfiguredModel } from "../../runtime/model-resolution.js";
import type { InboundProcessingContext } from "./types.js";

export async function compactConversationIfNeeded(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent || !context.conversation) {
    return;
  }

  const model = resolveConfiguredModel(
    context.agent.model,
    context.dependencies.resolveModel ?? defaultResolveModel,
  );
  if (!model || !shouldCompactConversation(context.conversation, model.contextWindow)) {
    return;
  }

  try {
    const result = await compactConversation({
      conversation: context.conversation,
      agent: context.agent,
      message: context.message,
      engine: context.dependencies.engine,
      conversationStore: context.dependencies.conversationStore,
      runtimeInfo: context.dependencies.runtimeInfo,
      model,
      force: false,
      keepRecentTokens: Math.min(
        DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
        Math.max(2_000, Math.floor(model.contextWindow * 0.2)),
      ),
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
