import type { AgentRegistry } from "../../agents/registry.js";
import { loadAppConfig } from "../../config/load-app-config.js";
import type { IncomingMessage, IncomingMessageCommand, OutgoingMessage } from "../../domain/message.js";
import type { LogLevel, Logger } from "../../logging/types.js";
import { readRecentLogLines } from "../../logging/view-logs.js";
import type { AgentEngine } from "../../runtime/types.js";
import type { ConversationStore } from "../../storage/types.js";

export interface RuntimeCommandInfo {
  botId: string;
  configPath: string;
  dataRoot: string;
  logFilePath: string;
  loggingLevel: LogLevel;
  activeBotIds: string[];
}

export interface HandleIncomingMessageDependencies {
  agentRegistry: AgentRegistry;
  conversationStore: ConversationStore;
  engine: AgentEngine;
  defaultAgentId: string;
  runtimeInfo: RuntimeCommandInfo;
  loadAppConfig?: typeof loadAppConfig;
  readRecentLogLines?: typeof readRecentLogLines;
  logger?: Logger;
}

export interface InboundCommandContext {
  message: IncomingMessage;
  dependencies: HandleIncomingMessageDependencies;
  loadAppConfig: typeof loadAppConfig;
  readRecentLogLines: typeof readRecentLogLines;
  logger?: Logger;
}

export interface InboundCommandMetadata {
  name: IncomingMessageCommand;
  description: string;
  usage?: string;
}

export interface InboundCommandHandler {
  metadata: InboundCommandMetadata;
  canHandle(command: IncomingMessage["command"]): boolean;
  handle(context: InboundCommandContext): Promise<OutgoingMessage | undefined>;
}
