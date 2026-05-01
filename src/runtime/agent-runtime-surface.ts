import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import { resolveEffectiveSkills } from "../skills/resolve-effective-skills.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentRunRuntimeContext } from "./context.js";
import type { McpToolCache } from "./mcp-tool-cache.js";
import {
  createDefaultPromptTemplateSystemContext,
  createPromptTemplateContext,
  type PromptTemplateSystemContext,
} from "./prompt-template.js";
import { resolveRuntimeTools } from "./pipeline/resolve-tools-stage.js";
import {
  createBuiltInToolRegistry,
  type WorkingDirectoryState,
} from "./tool-resolution.js";
import type { AgentEngine } from "./types.js";

export interface AgentRuntimeSurface {
  tools: string[];
  skills: string[];
  missingBuiltInTools: string[];
  failedMcpServers: string[];
  skillIssues: string[];
}

export interface AgentRuntimeSurfaceResolverInput {
  agent: AgentDefinition;
  conversation?: ConversationContext;
  message: IncomingMessage;
  runtime?: AgentRunRuntimeContext;
}

export type AgentRuntimeSurfaceResolver = (
  input: AgentRuntimeSurfaceResolverInput,
) => Promise<AgentRuntimeSurface>;

export function createAgentRuntimeSurfaceResolver(dependencies: {
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (
    workingDirectory: string | WorkingDirectoryState,
    agent?: AgentDefinition,
  ) => ToolRegistry;
  mcpToolCache: McpToolCache;
  agentRegistry?: AgentRegistry;
  promptTemplateSystemContext?: PromptTemplateSystemContext;
}): AgentRuntimeSurfaceResolver {
  const buildToolRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const promptTemplateSystemContext =
    dependencies.promptTemplateSystemContext ?? createDefaultPromptTemplateSystemContext();

  return async (input) => {
    const conversation = input.conversation ?? createEphemeralConversation(input.agent, input.message);
    const skillResolution = await resolveEffectiveSkills({
      agent: input.agent,
      dataRoot: input.runtime?.dataRoot,
      conversation,
    });
    const runtime = {
      ...input.runtime,
      ...(skillResolution.skills.length > 0 ? { availableSkills: skillResolution.skills } : {}),
    };
    const templateContext = createPromptTemplateContext({
      system: promptTemplateSystemContext,
      agent: input.agent,
      conversation,
      endpointId: input.message.endpointId,
      transportKind: input.message.conversation.transport,
      replyChannel: runtime.replyChannel,
      invocation: runtime.invocation,
      ingress: runtime.ingress,
      output: runtime.output,
      configPath: runtime.configPath,
      dataRoot: runtime.dataRoot,
      availableSkills: skillResolution.skills,
    });
    const toolResolution = await resolveRuntimeTools({
      agent: input.agent,
      conversation,
      message: input.message,
      runtime,
      templateContext,
    }, {
      toolRegistry: dependencies.toolRegistry,
      createBuiltInToolRegistry: buildToolRegistry,
      mcpToolCache: dependencies.mcpToolCache,
      agentRegistry: dependencies.agentRegistry,
      runDelegatedAgent: dependencies.agentRegistry ? inspectOnlyDelegatedAgentRun : undefined,
    });

    return {
      tools: toolResolution.toolResolution.resolvedTools,
      skills: skillResolution.skills.map((skill) => skill.name),
      missingBuiltInTools: toolResolution.toolResolution.missingBuiltInTools,
      failedMcpServers: toolResolution.toolResolution.failedMcpServers,
      skillIssues: skillResolution.issues,
    };
  };
}

const inspectOnlyDelegatedAgentRun: AgentEngine["run"] = async () => {
  throw new Error("Delegated agent inspection stubs must not be executed.");
};

function createEphemeralConversation(
  agent: AgentDefinition,
  message: IncomingMessage,
): ConversationContext {
  return {
    state: {
      conversation: message.conversation,
      agentId: agent.id,
      createdAt: message.receivedAt,
      updatedAt: message.receivedAt,
      version: 1,
    },
    messages: [],
  };
}
