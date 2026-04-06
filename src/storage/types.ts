import type { ConversationContext, ConversationRef } from "../domain/conversation.js";

export interface ConversationBackupSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  agentId: string;
  messageCount: number;
  workingDirectory?: string;
}

export interface ConversationStore {
  get(ref: ConversationRef): Promise<ConversationContext | undefined>;
  put(context: ConversationContext): Promise<void>;
  listBackups(ref: ConversationRef): Promise<ConversationBackupSummary[]>;
  restore(ref: ConversationRef, backupId: string, options?: { now?: Date }): Promise<boolean>;
  reset(ref: ConversationRef, options?: { now?: Date }): Promise<void>;
}
