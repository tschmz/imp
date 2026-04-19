import type { AgentDefinition } from "../domain/agent.js";
import type {
  ConversationContext,
  ConversationEvent,
  ConversationSystemPromptSnapshot,
} from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { SkillDefinition } from "../skills/types.js";

export interface AgentRunRuntimeContext {
  configPath?: string;
  dataRoot?: string;
  availableSkills?: SkillDefinition[];
  replyChannel?: ReplyChannelContext;
}

export interface ReplyChannelContext {
  kind: string;
  delivery: "endpoint" | "outbox" | "none";
  endpointId?: string;
}

export interface AgentRunInput {
  agent: AgentDefinition;
  conversation: ConversationContext;
  message: IncomingMessage;
  runtime?: AgentRunRuntimeContext;
  onConversationEvents?: (events: ConversationEvent[]) => Promise<void> | void;
  onSystemPromptResolved?: (snapshot: ConversationSystemPromptSnapshot) => Promise<void> | void;
  continueFromContext?: boolean;
}

export interface AgentRunResult {
  message: OutgoingMessage;
  conversationEvents: ConversationEvent[];
  workingDirectory?: string;
}
