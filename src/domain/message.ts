import type { ConversationRef } from "./conversation.js";

export interface IncomingMessage {
  conversation: ConversationRef;
  messageId: string;
  userId: string;
  text: string;
  receivedAt: string;
}

export interface OutgoingMessage {
  conversation: ConversationRef;
  text: string;
}
