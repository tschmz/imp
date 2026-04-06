import type { ConversationRef } from "./conversation.js";

export type IncomingMessageCommand = "new";

export interface IncomingMessage {
  botId: string;
  conversation: ConversationRef;
  messageId: string;
  correlationId: string;
  userId: string;
  text: string;
  receivedAt: string;
  command?: IncomingMessageCommand;
}

export interface OutgoingMessage {
  conversation: ConversationRef;
  text: string;
}
