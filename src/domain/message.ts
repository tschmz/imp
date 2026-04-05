import type { ConversationRef } from "./conversation.js";

export interface IncomingMessage {
  botId: string;
  conversation: ConversationRef;
  messageId: string;
  correlationId: string;
  userId: string;
  text: string;
  receivedAt: string;
}

export interface OutgoingMessage {
  conversation: ConversationRef;
  text: string;
}
