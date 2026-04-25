import type { ChatRef, ConversationRef } from "./conversation.js";

export type IncomingMessageCommand =
  | "new"
  | "help"
  | "status"
  | "history"
  | "resume"
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
  conversation: ConversationRef;
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
  kind: "text" | "telegram-voice-transcript" | "telegram-document" | "telegram-image" | "plugin-event";
  transcript?: {
    provider: string;
    model: string;
  };
  document?: IncomingMessageDocumentAttachment;
  image?: IncomingMessageImageAttachment;
  plugin?: IncomingMessagePluginSource;
}

export interface IncomingMessagePluginSource {
  pluginId: string;
  eventId: string;
  fileName: string;
  metadata?: Record<string, unknown>;
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

export interface IncomingMessageImageAttachment {
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  relativePath?: string;
  savedPath?: string;
  telegramType?: "photo" | "document";
}

export interface OutgoingMessage {
  conversation: ChatRef;
  text: string;
  attachments?: OutgoingMessageAttachment[];
  replay?: OutgoingMessageReplayItem[];
  deliveryAction?: OutgoingMessageDeliveryAction;
}

export interface OutgoingMessageAttachment {
  kind: "file";
  path: string;
  fileName?: string;
  mimeType?: string;
}

export interface OutgoingMessageReplayItem {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}
