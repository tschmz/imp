import type { ConversationContext, ConversationRef } from "../domain/conversation.js";

export interface ConversationStore {
  get(ref: ConversationRef): Promise<ConversationContext | undefined>;
  put(context: ConversationContext): Promise<void>;
  reset(ref: ConversationRef, options?: { now?: Date }): Promise<void>;
}
