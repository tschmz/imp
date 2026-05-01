import type { AgentRegistry } from "../../agents/registry.js";
import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import type { IncomingMessage } from "../../domain/message.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { McpToolCache } from "../mcp-tool-cache.js";
import { loadAgentHomePluginTools } from "../agent-home-plugin-tools.js";
import { createAgentDelegationTools } from "../agent-delegation-tool.js";
import { validateResolvedToolNames } from "../validate-resolved-tool-names.js";
import type { PromptTemplateContext } from "../prompt-template.js";
import {
  createOnPayloadOverride,
  createLoadSkillTool,
  createWorkingDirectoryState,
  resolveAgentTools,
  resolveWorkingDirectory,
  type WorkingDirectoryState,
} from "../tool-resolution.js";
import type { AgentEngine, AgentRunContext } from "../types.js";
import type { AgentRunRuntimeContext } from "../context.js";
import type { ResolvePromptStageContext } from "./resolve-prompt-stage.js";

export interface RuntimeToolResolutionDetails {
  configuredBuiltInTools: string[];
  resolvedBuiltInTools: string[];
  missingBuiltInTools: string[];
  configuredMcpServers: string[];
  initializedMcpServers: string[];
  failedMcpServers: string[];
  resolvedMcpTools: string[];
  resolvedTools: string[];
}

export interface ResolvedRuntimeTools {
  tools: NonNullable<AgentRunContext["tools"]>;
  workingDirectoryState: WorkingDirectoryState;
  initialWorkingDirectory: string;
  toolResolution: RuntimeToolResolutionDetails;
}

export interface ResolveToolsStageContext extends ResolvePromptStageContext {
  tools: NonNullable<AgentRunContext["tools"]>;
  workingDirectoryState: WorkingDirectoryState;
  initialWorkingDirectory: string;
  toolResolution: RuntimeToolResolutionDetails;
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
    agentRegistry?: AgentRegistry;
    runDelegatedAgent?: AgentEngine["run"];
  },
): Promise<ResolveToolsStageContext> {
  const resolvedTools = await resolveRuntimeTools({
    agent: context.agent,
    conversation: context.conversation,
    message: context.input.message,
    runtime: context.input.runtime,
    templateContext: context.templateContext,
  }, dependencies);

  return {
    ...context,
    ...resolvedTools,
  };
}

export async function resolveRuntimeTools(
  context: {
    agent: AgentDefinition;
    conversation: ConversationContext;
    message: IncomingMessage;
    runtime?: AgentRunRuntimeContext;
    templateContext: PromptTemplateContext;
  },
  dependencies: {
    toolRegistry?: ToolRegistry;
    createBuiltInToolRegistry: (
      workingDirectory: string | WorkingDirectoryState,
      agent?: AgentDefinition,
    ) => ToolRegistry;
    mcpToolCache: McpToolCache;
    agentRegistry?: AgentRegistry;
    runDelegatedAgent?: AgentEngine["run"];
  },
): Promise<ResolvedRuntimeTools> {
  const initialWorkingDirectory = resolveConversationWorkingDirectory(context.agent, context.conversation);
  const workingDirectoryState = createWorkingDirectoryState(initialWorkingDirectory);
  const baseToolRegistry =
    dependencies.toolRegistry
    ?? dependencies.createBuiltInToolRegistry(workingDirectoryState, context.agent);
  const agentHomePlugins = await loadAgentHomePluginTools(context.agent);
  const toolRegistry = mergeToolRegistries(baseToolRegistry, agentHomePlugins.tools);
  const configuredBuiltInTools = [...context.agent.tools];
  const resolvedConfiguredToolNames = dedupe([
    ...context.agent.tools.map((toolName) => agentHomePlugins.toolNameAliases[toolName] ?? toolName),
    ...agentHomePlugins.automaticToolNames,
  ]);
  const configuredTools = resolveAgentTools({
    ...context.agent,
    tools: resolvedConfiguredToolNames,
  }, toolRegistry);
  const builtInTools = resolveTurnBuiltInTools(
    configuredTools,
    context.runtime?.availableSkills ?? [],
    context.templateContext,
  );
  const delegationTools =
    dependencies.agentRegistry && dependencies.runDelegatedAgent
      ? createAgentDelegationTools(
          context.agent,
          context.conversation,
          context.message,
          context.runtime,
          {
            agentRegistry: dependencies.agentRegistry,
            runDelegatedAgent: dependencies.runDelegatedAgent,
          },
        )
      : [];
  const resolvedBuiltInTools = builtInTools.map((tool) => tool.name);
  const resolvedDelegationTools = delegationTools.map((tool) => tool.name);
  const missingBuiltInTools = configuredBuiltInTools.filter(
    (name) => !resolvedBuiltInTools.includes(name),
  );
  const mcpToolResolution = await dependencies.mcpToolCache.resolve(context.agent);
  const configuredMcpServers = context.agent.mcp?.servers.map((server) => server.id) ?? [];
  const resolvedMcpTools = mcpToolResolution.tools.map((tool) => tool.name);
  validateResolvedToolNames(context.agent.id, {
    builtIn: resolvedBuiltInTools,
    delegation: resolvedDelegationTools,
    mcp: resolvedMcpTools,
  });
  const resolvedTools = [...resolvedBuiltInTools, ...resolvedDelegationTools, ...resolvedMcpTools];

  return {
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
    tools: [...builtInTools, ...delegationTools, ...mcpToolResolution.tools],
  };
}

function resolveTurnBuiltInTools(
  builtInTools: ReturnType<typeof resolveAgentTools>,
  availableSkills: NonNullable<AgentRunContext["input"]["runtime"]>["availableSkills"],
  templateContext: ResolvePromptStageContext["templateContext"],
): ReturnType<typeof resolveAgentTools> {
  if (!availableSkills || availableSkills.length === 0) {
    return builtInTools;
  }

  return [
    ...builtInTools.filter((tool) => tool.name !== "load_skill"),
    createLoadSkillTool(availableSkills, templateContext),
  ];
}

function resolveConversationWorkingDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext,
): string {
  return conversation.state.workingDirectory ?? resolveWorkingDirectory(agent);
}

export { createOnPayloadOverride };

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeToolRegistries(baseRegistry: ToolRegistry, tools: ReturnType<ToolRegistry["list"]>): ToolRegistry {
  if (tools.length === 0) {
    return baseRegistry;
  }

  const pluginTools = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    list() {
      const merged = new Map(baseRegistry.list().map((tool) => [tool.name, tool]));
      for (const tool of tools) {
        merged.set(tool.name, tool);
      }
      return [...merged.values()];
    },
    get(name) {
      return pluginTools.get(name) ?? baseRegistry.get(name);
    },
    pick(names) {
      return names.flatMap((name) => {
        const tool = pluginTools.get(name) ?? baseRegistry.get(name);
        return tool ? [tool] : [];
      });
    },
  };
}
