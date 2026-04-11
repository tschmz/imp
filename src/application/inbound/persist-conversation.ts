import type { InboundProcessingContext } from "./types.js";

export async function persistConversation(context: InboundProcessingContext): Promise<void> {
  if (!context.conversation || !context.agent || !context.response) {
    return;
  }

  await context.dependencies.conversationStore.put(context.conversation);
}
