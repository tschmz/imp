import type { ConversationRef, ConversationState } from "../domain/conversation.js";

export interface ConversationStore {
  get(ref: ConversationRef): Promise<ConversationState | undefined>;
  put(state: ConversationState): Promise<void>;
}
