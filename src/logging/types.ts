export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogRotationSize = `${number}${"B" | "K" | "M" | "G"}`;

export interface LogErrorFields {
  type: string;
  message: string;
  stack?: string;
  causeType?: string;
  causeMessage?: string;
}

export interface LogFields {
  event?: string;
  component?: string;
  endpointId?: string;
  pluginId?: string;
  transport?: string;
  conversationId?: string;
  messageId?: string;
  agentId?: string;
  correlationId?: string;
  command?: string;
  jobId?: string;
  sourceFile?: string;
  backupId?: string;
  durationMs?: number;
  cacheHit?: boolean;
  error?: LogErrorFields;
  errorType?: string;
  errorMessage?: string;
  errorStack?: string;
  errorCauseType?: string;
  errorCauseMessage?: string;
  agentStopReason?: string;
  upstreamErrorMessage?: string;
  upstreamProvider?: string;
  upstreamModel?: string;
  upstreamApi?: string;
  upstreamResponseId?: string;
  assistantContentTypes?: string[];
  assistantTextLength?: number;
  assistantToolCallNames?: string[];
  assistantHasThinking?: boolean;
  fileName?: string;
  failedPath?: string;
  errorRecordPath?: string;
  rootDir?: string;
  inboxDir?: string;
  processingDir?: string;
  processedDir?: string;
  failedDir?: string;
  outboxDir?: string;
  hookName?: string;
  hookRegistrationName?: string;
  skillNames?: string[];
  configuredSkillNames?: string[];
  configuredInstructionFiles?: string[];
  configuredReferenceFiles?: string[];
  basePromptSource?: "built-in" | "file" | "text" | "unknown";
  basePromptFile?: string;
  basePromptBuiltIn?: string;
  instructionFiles?: string[];
  agentHomeInstructionFiles?: string[];
  workspaceInstructionFile?: string;
  referenceFiles?: string[];
  globalSkillsPath?: string;
  userSharedSkillsPath?: string;
  agentHomeSkillsPath?: string;
  workspaceDirectory?: string;
  legacyWorkspaceSkillsPath?: string;
  workspaceAgentSkillsPath?: string;
  workspaceSkillsPath?: string;
  overriddenSkillNames?: string[];
  initialWorkingDirectory?: string;
  configuredBuiltInTools?: string[];
  resolvedBuiltInTools?: string[];
  interruptedRunCount?: number;
  defaultAgentId?: string;
  paths?: Record<string, string>;
  missingBuiltInTools?: string[];
  configuredMcpServers?: string[];
  initializedMcpServers?: string[];
  failedMcpServers?: string[];
  resolvedMcpTools?: string[];
  resolvedTools?: string[];
  requestModel?: string;
  requestStore?: boolean;
  requestPreviousResponseId?: string;
  requestInputCount?: number;
  requestToolCount?: number;
}

export interface Logger {
  debug(message: string, fields?: LogFields): Promise<void>;
  info(message: string, fields?: LogFields): Promise<void>;
  error(message: string, fields?: LogFields, error?: unknown): Promise<void>;
  close?(): Promise<void>;
}
