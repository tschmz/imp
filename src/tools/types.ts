import type { ConversationRef } from "../domain/conversation.js";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core";

export interface ToolExecutionContext {
  agentId: string;
  conversation: ConversationRef;
  workingDirectory?: string;
}

type ToolExecutionFn = {
  bivarianceHack(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<unknown>,
  ): Promise<AgentToolResult<unknown>>;
}["bivarianceHack"];

export type ToolDefinition = Omit<AgentTool, "execute"> & {
  execute: ToolExecutionFn;
};
