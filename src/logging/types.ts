export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  botId?: string;
  transport?: string;
  conversationId?: string;
  messageId?: string;
  agentId?: string;
  correlationId?: string;
  durationMs?: number;
  errorType?: string;
}

export interface Logger {
  info(message: string, fields?: LogFields): Promise<void>;
  error(message: string, fields?: LogFields, error?: unknown): Promise<void>;
}
