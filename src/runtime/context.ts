import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext, ConversationEvent } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { SkillDefinition } from "../skills/types.js";

export interface AgentRunRuntimeContext {
  configPath?: string;
  dataRoot?: string;
  activatedSkills?: SkillDefinition[];
}

export interface AgentRunInput {
  agent: AgentDefinition;
  conversation: ConversationContext;
  message: IncomingMessage;
  runtime?: AgentRunRuntimeContext;
}

export interface AgentRunResult {
  message: OutgoingMessage;
  conversationEvents: ConversationEvent[];
  workingDirectory?: string;
}
