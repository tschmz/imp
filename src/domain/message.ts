import type { ConversationRef } from "./conversation.js";

export type IncomingMessageCommand = "new" | "help" | "status" | "history" | "restore";

export interface IncomingMessage {
  botId: string;
  conversation: ConversationRef;
  messageId: string;
  correlationId: string;
  userId: string;
  text: string;
  receivedAt: string;
  command?: IncomingMessageCommand;
  commandArgs?: string;
}

export interface OutgoingMessage {
  conversation: ConversationRef;
  text: string;
}
