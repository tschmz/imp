export interface ChatRef {
  transport: string;
  externalId: string;
}

export interface ConversationRef extends ChatRef {
  sessionId?: string;
}

export type ConversationMessageRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  kind?: "message";
  id: string;
  role: ConversationMessageRole;
  text: string;
  createdAt: string;
  correlationId?: string;
  source?: ConversationMessageSource;
}

export interface ConversationToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ConversationToolCallEvent {
  kind: "tool-call";
  id: string;
  createdAt: string;
  correlationId?: string;
  text?: string;
  toolCalls: ConversationToolCall[];
}

export interface ConversationImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ConversationTextContent {
  type: "text";
  text: string;
}

export type ConversationToolResultContent =
  | ConversationTextContent
  | ConversationImageContent;

export interface ConversationToolResultEvent {
  kind: "tool-result";
  id: string;
  createdAt: string;
  correlationId?: string;
  toolCallId: string;
  toolName: string;
  content: ConversationToolResultContent[];
  details?: unknown;
  isError: boolean;
}

export type ConversationEvent =
  | ConversationMessage
  | ConversationToolCallEvent
  | ConversationToolResultEvent;

export interface ConversationMessageSource {
  kind: "text" | "telegram-voice-transcript";
  transcript?: {
    provider: string;
    model: string;
  };
}

export interface ConversationState {
  conversation: ConversationRef;
  agentId: string;
  title?: string;
  workingDirectory?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ConversationContext {
  state: ConversationState;
  messages: ConversationEvent[];
}
