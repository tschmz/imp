export interface ConversationRef {
  transport: string;
  externalId: string;
}

export interface ConversationState {
  conversation: ConversationRef;
  agentId: string;
  createdAt: string;
  updatedAt: string;
}
