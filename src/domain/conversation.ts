export interface ConversationRef {
  transport: string;
  externalId: string;
}

export type ConversationMessageRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  text: string;
  createdAt: string;
}

export interface ConversationState {
  conversation: ConversationRef;
  agentId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationContext {
  state: ConversationState;
  messages: ConversationMessage[];
}
