export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  botId?: string;
  transport?: string;
  conversationId?: string;
  messageId?: string;
  agentId?: string;
  correlationId?: string;
  command?: string;
  backupId?: string;
  durationMs?: number;
  errorType?: string;
  hookName?: string;
  hookRegistrationName?: string;
  skillCount?: number;
  skillNames?: string[];
}

export interface Logger {
  debug(message: string, fields?: LogFields): Promise<void>;
  info(message: string, fields?: LogFields): Promise<void>;
  error(message: string, fields?: LogFields, error?: unknown): Promise<void>;
}
