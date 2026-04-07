import type { ChatRef } from "./conversation.js";

export type IncomingMessageCommand =
  | "new"
  | "help"
  | "status"
  | "history"
  | "restore"
  | "whoami"
  | "rename"
  | "reset"
  | "export"
  | "ping"
  | "config"
  | "agent"
  | "logs"
  | "reload"
  | "restart";

export type OutgoingMessageDeliveryAction = "reload" | "restart";

export interface IncomingMessage {
  botId: string;
  conversation: ChatRef;
  messageId: string;
  correlationId: string;
  userId: string;
  text: string;
  receivedAt: string;
  command?: IncomingMessageCommand;
  commandArgs?: string;
}

export interface OutgoingMessage {
  conversation: ChatRef;
  text: string;
  deliveryAction?: OutgoingMessageDeliveryAction;
}
