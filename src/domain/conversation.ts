export interface ChatRef {
  transport: string;
  externalId: string;
}

export interface ConversationRef extends ChatRef {
  sessionId?: string;
}

export type ConversationMessageRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  text: string;
  createdAt: string;
  correlationId?: string;
}

export interface ConversationState {
  conversation: ConversationRef;
  agentId: string;
  title?: string;
  workingDirectory?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ConversationContext {
  state: ConversationState;
  messages: ConversationMessage[];
}
