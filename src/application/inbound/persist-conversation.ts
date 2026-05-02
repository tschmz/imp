import type { ResolvedHandledInboundProcessingContext } from "./types.js";

export async function persistConversation(
  context: ResolvedHandledInboundProcessingContext,
): Promise<ResolvedHandledInboundProcessingContext> {
  await context.dependencies.conversationStore.put(context.conversation);
  return context;
}
