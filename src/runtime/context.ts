import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";

export interface AgentRunInput {
  agent: AgentDefinition;
  conversation: ConversationContext;
  message: IncomingMessage;
}

export interface AgentRunResult {
  message: OutgoingMessage;
}
