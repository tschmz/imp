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
}

export interface ConversationRef extends ChatRef {
  sessionId?: string;
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
