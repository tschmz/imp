import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";

export interface AgentRunRuntimeContext {
  configPath?: string;
  dataRoot?: string;
}

export interface AgentRunInput {
  agent: AgentDefinition;
  conversation: ConversationContext;
  message: IncomingMessage;
  runtime?: AgentRunRuntimeContext;
}

export interface AgentRunResult {
  message: OutgoingMessage;
  workingDirectory?: string;
}
