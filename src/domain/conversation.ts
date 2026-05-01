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
  sessionId?: string;
}

export interface ConversationRef extends ChatRef {
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
  kind: "text" | "telegram-voice-transcript" | "telegram-document" | "telegram-image" | "plugin-event" | "scheduled";
  transcript?: {
    provider: string;
    model: string;
  };
  document?: ConversationDocumentAttachment;
  image?: ConversationImageAttachment;
  plugin?: ConversationPluginSource;
  scheduled?: ConversationScheduledSource;
}

export interface ConversationScheduledSource {
  jobId: string;
  sourceFile: string;
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

export interface ConversationImageAttachment {
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

export interface ConversationState {
  conversation: ConversationRef;
  agentId: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  title?: string;
  workingDirectory?: string;
  compaction?: ConversationCompactionState;
  run?: ConversationRunState;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ConversationContext {
  state: ConversationState;
  messages: ConversationEvent[];
}

export interface ConversationSystemPromptSnapshot {
  messageId: string;
  correlationId: string;
  agentId: string;
  createdAt: string;
  content: string;
  cacheHit: boolean;
  sources: ConversationSystemPromptSourceSummary;
  promptWorkingDirectory?: string;
}

export interface ConversationSystemPromptSourceSummary {
  basePromptSource: "built-in" | "file" | "text" | "unknown";
  basePromptFile?: string;
  basePromptBuiltIn?: string;
  instructionFiles: string[];
  configuredInstructionFiles: string[];
  agentHomeInstructionFiles: string[];
  workspaceInstructionFile?: string;
  referenceFiles: string[];
  configuredReferenceFiles: string[];
}

export interface ConversationRunState {
  status: "idle" | "running" | "failed" | "interrupted";
  messageId?: string;
  correlationId?: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
}

export interface ConversationCompactionState {
  summary: string;
  firstKeptMessageId: string;
  compactedThroughMessageId: string;
  createdAt: string;
  messageCountBefore: number;
  messageCountSummarized: number;
  messageCountKept: number;
  sequence: number;
  tokensBefore?: number;
  tokensAfter?: number;
  model?: {
    provider: string;
    model: string;
    api?: string;
  };
}
