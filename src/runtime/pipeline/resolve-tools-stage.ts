import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { McpToolCache } from "../mcp-tool-cache.js";
import {
  createOnPayloadOverride,
  createWorkingDirectoryState,
  resolveAgentTools,
  resolveWorkingDirectory,
  type WorkingDirectoryState,
} from "../tool-resolution.js";
import type { AgentRunContext } from "../types.js";
import type { ResolvePromptStageContext } from "./resolve-prompt-stage.js";

export interface ResolveToolsStageContext extends ResolvePromptStageContext {
  tools: NonNullable<AgentRunContext["tools"]>;
  workingDirectoryState: WorkingDirectoryState;
  initialWorkingDirectory: string;
}

export async function resolveToolsStage(
  context: ResolvePromptStageContext,
  dependencies: {
    toolRegistry?: ToolRegistry;
    createBuiltInToolRegistry: (
      workingDirectory: string | WorkingDirectoryState,
      agent?: AgentDefinition,
    ) => ToolRegistry;
    mcpToolCache: McpToolCache;
  },
): Promise<ResolveToolsStageContext> {
  const initialWorkingDirectory = resolveConversationWorkingDirectory(context.agent, context.conversation);
  const workingDirectoryState = createWorkingDirectoryState(initialWorkingDirectory);
  const toolRegistry =
    dependencies.toolRegistry
    ?? dependencies.createBuiltInToolRegistry(workingDirectoryState, context.agent);
  const builtInTools = resolveAgentTools(context.agent, toolRegistry);
  const mcpToolResolution = await dependencies.mcpToolCache.resolve(context.agent);

  return {
    ...context,
    initialWorkingDirectory,
    workingDirectoryState,
    tools: [...builtInTools, ...mcpToolResolution.tools],
  };
}

function resolveConversationWorkingDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext,
): string {
  return conversation.state.workingDirectory ?? resolveWorkingDirectory(agent);
}

export { createOnPayloadOverride };
