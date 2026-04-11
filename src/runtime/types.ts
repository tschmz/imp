import type { Api as AiApi, Model } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { ToolDefinition } from "../tools/types.js";
import type { AgentRunInput, AgentRunResult } from "./context.js";
import type { SystemPromptResolutionResult } from "./system-prompt-resolution.js";
import type { WorkingDirectoryState } from "./tool-resolution.js";

export interface AgentEngine {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  close?(): Promise<void>;
}

export interface AgentRunContext {
  input: AgentRunInput;
  agent: AgentDefinition;
  conversation: ConversationContext;
  model?: Model<AiApi>;
  systemPromptResolution?: SystemPromptResolutionResult;
  tools?: ToolDefinition[];
  workingDirectoryState?: WorkingDirectoryState;
  initialWorkingDirectory?: string;
  promptWorkingDirectory?: string;
  result?: AgentRunResult;
}
