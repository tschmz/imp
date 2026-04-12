import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { McpToolCache } from "../mcp-tool-cache.js";
import {
  createOnPayloadOverride,
  createLoadSkillTool,
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
  toolResolution: {
    configuredBuiltInTools: string[];
    resolvedBuiltInTools: string[];
    missingBuiltInTools: string[];
    configuredMcpServers: string[];
    initializedMcpServers: string[];
    failedMcpServers: string[];
    resolvedMcpTools: string[];
    resolvedTools: string[];
  };
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
  const configuredBuiltInTools = [...context.agent.tools];
  const configuredTools = resolveAgentTools(context.agent, toolRegistry);
  const builtInTools = resolveTurnBuiltInTools(
    configuredTools,
    context.input.runtime?.availableSkills ?? [],
  );
  const resolvedBuiltInTools = builtInTools.map((tool) => tool.name);
  const missingBuiltInTools = configuredBuiltInTools.filter(
    (name) => !resolvedBuiltInTools.includes(name),
  );
  const mcpToolResolution = await dependencies.mcpToolCache.resolve(context.agent);
  const configuredMcpServers = context.agent.mcp?.servers.map((server) => server.id) ?? [];
  const resolvedMcpTools = mcpToolResolution.tools.map((tool) => tool.name);
  const resolvedTools = [...resolvedBuiltInTools, ...resolvedMcpTools];

  return {
    ...context,
    initialWorkingDirectory,
    workingDirectoryState,
    toolResolution: {
      configuredBuiltInTools,
      resolvedBuiltInTools,
      missingBuiltInTools,
      configuredMcpServers,
      initializedMcpServers: mcpToolResolution.initializedServerIds,
      failedMcpServers: mcpToolResolution.failedServerIds,
      resolvedMcpTools,
      resolvedTools,
    },
    tools: [...builtInTools, ...mcpToolResolution.tools],
  };
}

function resolveTurnBuiltInTools(
  builtInTools: ReturnType<typeof resolveAgentTools>,
  availableSkills: NonNullable<AgentRunContext["input"]["runtime"]>["availableSkills"],
): ReturnType<typeof resolveAgentTools> {
  if (!availableSkills || availableSkills.length === 0) {
    return builtInTools;
  }

  return [
    ...builtInTools.filter((tool) => tool.name !== "load_skill"),
    createLoadSkillTool(availableSkills),
  ];
}

function resolveConversationWorkingDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext,
): string {
  return conversation.state.workingDirectory ?? resolveWorkingDirectory(agent);
}

export { createOnPayloadOverride };
