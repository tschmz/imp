import type { ChatRef, ConversationContext, ConversationRef } from "../domain/conversation.js";

export interface ConversationBackupSummary {
  id: string;
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  agentId: string;
  messageCount: number;
  workingDirectory?: string;
}

export interface ConversationStore {
  get(ref: ChatRef | ConversationRef): Promise<ConversationContext | undefined>;
  put(context: ConversationContext): Promise<void>;
  listBackups(ref: ChatRef): Promise<ConversationBackupSummary[]>;
  restore(ref: ChatRef, backupId: string, options?: { now?: Date }): Promise<boolean>;
  ensureActive(ref: ChatRef, options: { agentId: string; now: string }): Promise<ConversationContext>;
  create(ref: ChatRef, options: { agentId: string; now: string }): Promise<ConversationContext>;
}
