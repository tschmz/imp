import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";

export interface ChatRef {
  transport: string;
  externalId: string;
  endpointId?: string;
}

export interface ConversationRef extends ChatRef {
  sessionId?: string;
  agentId?: string;
}

export interface ConversationEventBase {
  kind?: "message";
  id: string;
  createdAt: string;
  correlationId?: string;
}

export interface ConversationUserMessage extends ConversationEventBase {
  role: "user";
  content: UserMessage["content"];
  timestamp: number;
  source?: ConversationMessageSource;
}

export interface ConversationAssistantMessage
  extends ConversationEventBase,
    Omit<AssistantMessage, "timestamp"> {
  role: "assistant";
  content: Array<TextContent | ThinkingContent | ToolCall>;
  timestamp: number;
}

export interface ConversationToolResultMessage
  extends ConversationEventBase,
    Omit<ToolResultMessage, "timestamp"> {
  role: "toolResult";
  content: Array<TextContent | ImageContent>;
  timestamp: number;
}

export type ConversationEvent =
  | ConversationUserMessage
  | ConversationAssistantMessage
  | ConversationToolResultMessage;

export interface ConversationMessageSource {
  kind: "text" | "telegram-voice-transcript" | "telegram-document" | "plugin-event";
  transcript?: {
    provider: string;
    model: string;
  };
  document?: ConversationDocumentAttachment;
  plugin?: ConversationPluginSource;
}

export interface ConversationPluginSource {
  pluginId: string;
  eventId: string;
  fileName: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationDocumentAttachment {
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  relativePath?: string;
  savedPath?: string;
}

export interface ConversationState {
  conversation: ConversationRef;
  agentId: string;
  title?: string;
  workingDirectory?: string;
  run?: ConversationRunState;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ConversationContext {
  state: ConversationState;
  messages: ConversationEvent[];
}

export interface ConversationRunState {
  status: "idle" | "running" | "failed" | "interrupted";
  messageId?: string;
  correlationId?: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
}
