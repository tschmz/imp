import type {
  ChatRef,
  ConversationContext,
  ConversationEvent,
  ConversationRef,
  ConversationState,
  ConversationSystemPromptSnapshot,
} from "../domain/conversation.js";

export interface ConversationBackupSummary {
  id: string;
  sessionId: string;
  transport?: string;
  externalId?: string;
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
  appendEvents?(context: ConversationContext, events: ConversationEvent[]): Promise<ConversationContext>;
  updateState?(context: ConversationContext, patch: Partial<ConversationState>): Promise<ConversationContext>;
  writeSystemPromptSnapshot?(context: ConversationContext, snapshot: ConversationSystemPromptSnapshot): Promise<void>;
  markInterruptedRuns?(now: string): Promise<number>;
  listInterruptedRuns?(): Promise<ConversationContext[]>;
  listBackups(ref: ChatRef): Promise<ConversationBackupSummary[]>;
  restore(ref: ChatRef, backupId: string, options?: { now?: Date }): Promise<boolean>;
  ensureActive(ref: ChatRef, options: { agentId: string; now: string; title?: string }): Promise<ConversationContext>;
  create(ref: ChatRef, options: { agentId: string; now: string; title?: string }): Promise<ConversationContext>;
  getSelectedAgent?(ref: ChatRef): Promise<string | undefined>;
  setSelectedAgent?(ref: ChatRef, agentId: string): Promise<void>;
  getActiveForAgent?(agentId: string): Promise<ConversationContext | undefined>;
  listBackupsForAgent?(agentId: string): Promise<ConversationBackupSummary[]>;
  restoreForAgent?(agentId: string, backupId: string, options?: { now?: Date }): Promise<boolean>;
  ensureActiveForAgent?(ref: ChatRef, options: { agentId: string; now: string; title?: string }): Promise<ConversationContext>;
  createForAgent?(ref: ChatRef, options: { agentId: string; now: string; title?: string }): Promise<ConversationContext>;
  ensureDetachedForAgent?(
    ref: ConversationRef,
    options: {
      agentId: string;
      now: string;
      title?: string;
      kind?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ConversationContext>;
}
