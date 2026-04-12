export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  endpointId?: string;
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
  globalSkillsPath?: string;
  agentHomeSkillsPath?: string;
  workspaceDirectory?: string;
  workspaceSkillsPath?: string;
  overriddenSkillNames?: string[];
  initialWorkingDirectory?: string;
  configuredBuiltInTools?: string[];
  resolvedBuiltInTools?: string[];
  missingBuiltInTools?: string[];
  configuredMcpServers?: string[];
  initializedMcpServers?: string[];
  failedMcpServers?: string[];
  resolvedMcpTools?: string[];
  resolvedTools?: string[];
}

export interface Logger {
  debug(message: string, fields?: LogFields): Promise<void>;
  info(message: string, fields?: LogFields): Promise<void>;
  error(message: string, fields?: LogFields, error?: unknown): Promise<void>;
}
