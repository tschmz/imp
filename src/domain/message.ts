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
  endpointId: string;
  conversation: ChatRef;
  messageId: string;
  correlationId: string;
  userId: string;
  text: string;
  receivedAt: string;
  source?: IncomingMessageSource;
  command?: IncomingMessageCommand;
  commandArgs?: string;
}

export interface IncomingMessageSource {
  kind: "text" | "telegram-voice-transcript" | "telegram-document";
  transcript?: {
    provider: string;
    model: string;
  };
  document?: IncomingMessageDocumentAttachment;
}

export interface IncomingMessageDocumentAttachment {
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  relativePath?: string;
  savedPath?: string;
}

export interface OutgoingMessage {
  conversation: ChatRef;
  text: string;
  deliveryAction?: OutgoingMessageDeliveryAction;
}
