import { randomUUID } from "node:crypto";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition, AgentDelegationConfig } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import { resolveEffectiveSkills } from "../skills/resolve-effective-skills.js";
import type { ToolDefinition } from "../tools/types.js";
import type { AgentRunRuntimeContext } from "./context.js";
import type { AgentEngine } from "./types.js";
import { createUserVisibleToolError, toUserVisibleToolError } from "./user-visible-tool-error.js";

const maxDelegationDepth = 1;

export function createAgentDelegationTools(
  parentAgent: AgentDefinition,
  conversation: ConversationContext,
  parentMessage: IncomingMessage,
  runtime: AgentRunRuntimeContext | undefined,
  dependencies: {
    agentRegistry: AgentRegistry;
    runDelegatedAgent: AgentEngine["run"];
    logger?: Logger;
  },
): ToolDefinition[] {
  return (parentAgent.delegations ?? []).map((delegation) =>
    createAgentDelegationTool(parentAgent, delegation, conversation, parentMessage, runtime, dependencies),
  );
}

function createAgentDelegationTool(
  parentAgent: AgentDefinition,
  delegation: AgentDelegationConfig,
  conversation: ConversationContext,
  parentMessage: IncomingMessage,
  runtime: AgentRunRuntimeContext | undefined,
  dependencies: {
    agentRegistry: AgentRegistry;
    runDelegatedAgent: AgentEngine["run"];
    logger?: Logger;
  },
): ToolDefinition {
  const parameters = {
    type: "object",
    properties: {
      input: {
        type: "string",
        minLength: 1,
        description: `Input to send to delegated agent "${delegation.agentId}".`,
      },
    },
    required: ["input"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: delegation.toolName,
    label: delegation.toolName,
    description:
      delegation.description
      ?? `Ask configured delegated agent "${delegation.agentId}" and return only its final text response.`,
    parameters,
    async execute(toolCallId, params) {
      const childInput = parseDelegationParams(delegation.toolName, params);
      const currentDepth = runtime?.delegationDepth ?? 0;
      if (currentDepth >= maxDelegationDepth) {
        throw createUserVisibleToolError(
          "tool_command_execution",
          `Delegated agent calls may only nest one level. Agent "${parentAgent.id}" cannot delegate again from this run.`,
        );
      }

      if (delegation.agentId === parentAgent.id) {
        throw createUserVisibleToolError(
          "tool_command_execution",
          `Agent "${parentAgent.id}" cannot delegate to itself.`,
        );
      }

      const childAgent = dependencies.agentRegistry.get(delegation.agentId);
      if (!childAgent) {
        throw createUserVisibleToolError(
          "tool_command_execution",
          `Unknown delegated agent id "${delegation.agentId}" for agent "${parentAgent.id}".`,
        );
      }

      const nestedMessage = createNestedMessage(parentMessage, toolCallId, childInput.input);
      const nestedConversation = createNestedConversation(conversation, childAgent.id, nestedMessage.receivedAt);
      const childSkills = await resolveDelegatedAgentSkills(childAgent, nestedConversation, runtime, dependencies.logger, nestedMessage);

      await dependencies.logger?.debug("starting delegated agent run", {
        agentId: childAgent.id,
        messageId: nestedMessage.messageId,
        correlationId: nestedMessage.correlationId,
      });

      const result = await dependencies.runDelegatedAgent({
        agent: childAgent,
        conversation: nestedConversation,
        message: nestedMessage,
        runtime: {
          ...(runtime?.configPath ? { configPath: runtime.configPath } : {}),
          ...(runtime?.dataRoot ? { dataRoot: runtime.dataRoot } : {}),
          ...(childSkills.length > 0 ? { availableSkills: childSkills } : {}),
          invocation: {
            kind: "delegated",
            parentAgentId: parentAgent.id,
            toolName: delegation.toolName,
          },
          ingress: runtime?.ingress ?? {
            endpointId: parentMessage.endpointId,
            transportKind: parentMessage.conversation.transport,
          },
          output: {
            mode: "delegated-tool",
          },
          delegationDepth: currentDepth + 1,
        },
      }).catch((error: unknown) => {
        throw toUserVisibleToolError(error, {
          fallbackMessage: `Delegated agent "${childAgent.id}" failed.`,
          defaultKind: "tool_command_execution",
        });
      });

      await dependencies.logger?.debug("completed delegated agent run", {
        agentId: childAgent.id,
        messageId: nestedMessage.messageId,
        correlationId: nestedMessage.correlationId,
      });

      return {
        content: [{ type: "text", text: result.message.text }],
        details: {
          delegatedAgentId: childAgent.id,
          toolName: delegation.toolName,
        },
      };
    },
  };
}

function parseDelegationParams(toolName: string, params: unknown): { input: string } {
  if (typeof params !== "object" || params === null) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `${toolName} requires an object parameter with an input string.`,
    );
  }

  const input = "input" in params ? params.input : undefined;
  if (typeof input !== "string" || input.length === 0) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `${toolName} requires a non-empty string input.`,
    );
  }

  return { input };
}

async function resolveDelegatedAgentSkills(
  childAgent: AgentDefinition,
  conversation: ConversationContext,
  runtime: AgentRunRuntimeContext | undefined,
  logger: Logger | undefined,
  message: IncomingMessage,
) {
  try {
    const resolution = await resolveEffectiveSkills({
      agent: childAgent,
      dataRoot: runtime?.dataRoot,
      conversation,
    });

    for (const issue of resolution.issues) {
      await logger?.info(issue, {
        endpointId: message.endpointId,
        transport: message.conversation.transport,
        conversationId: message.conversation.externalId,
        messageId: message.messageId,
        correlationId: message.correlationId,
        agentId: childAgent.id,
        ...(resolution.globalSkillsPath ? { globalSkillsPath: resolution.globalSkillsPath } : {}),
        ...(resolution.userSharedSkillsPath ? { userSharedSkillsPath: resolution.userSharedSkillsPath } : {}),
        ...(resolution.agentHomeSkillsPath ? { agentHomeSkillsPath: resolution.agentHomeSkillsPath } : {}),
        ...(resolution.workspaceDirectory ? { workspaceDirectory: resolution.workspaceDirectory } : {}),
        ...(resolution.workspaceAgentSkillsPath ? { workspaceAgentSkillsPath: resolution.workspaceAgentSkillsPath } : {}),
      });
    }

    if (resolution.overriddenSkillNames.length > 0) {
      await logger?.info("auto-discovered skills override earlier agent skills for turn", {
        endpointId: message.endpointId,
        transport: message.conversation.transport,
        conversationId: message.conversation.externalId,
        messageId: message.messageId,
        correlationId: message.correlationId,
        agentId: childAgent.id,
        ...(resolution.globalSkillsPath ? { globalSkillsPath: resolution.globalSkillsPath } : {}),
        ...(resolution.userSharedSkillsPath ? { userSharedSkillsPath: resolution.userSharedSkillsPath } : {}),
        ...(resolution.agentHomeSkillsPath ? { agentHomeSkillsPath: resolution.agentHomeSkillsPath } : {}),
        ...(resolution.workspaceDirectory ? { workspaceDirectory: resolution.workspaceDirectory } : {}),
        ...(resolution.workspaceAgentSkillsPath ? { workspaceAgentSkillsPath: resolution.workspaceAgentSkillsPath } : {}),
        overriddenSkillNames: resolution.overriddenSkillNames,
      });
    }

    await logger?.debug("resolved effective agent skills for turn", {
      event: "agent.skills.resolved",
      component: "agent-runtime",
      endpointId: message.endpointId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      agentId: childAgent.id,
      skillNames: resolution.skills.map((skill) => skill.name),
      ...(resolution.globalSkillsPath ? { globalSkillsPath: resolution.globalSkillsPath } : {}),
      ...(resolution.userSharedSkillsPath ? { userSharedSkillsPath: resolution.userSharedSkillsPath } : {}),
      ...(resolution.agentHomeSkillsPath ? { agentHomeSkillsPath: resolution.agentHomeSkillsPath } : {}),
      ...(resolution.workspaceDirectory ? { workspaceDirectory: resolution.workspaceDirectory } : {}),
      ...(resolution.workspaceAgentSkillsPath ? { workspaceAgentSkillsPath: resolution.workspaceAgentSkillsPath } : {}),
      ...(resolution.overriddenSkillNames.length > 0
        ? { overriddenSkillNames: resolution.overriddenSkillNames }
        : {}),
    });

    return resolution.skills;
  } catch (error) {
    void logger?.error(
      "failed to resolve effective agent skills for turn; continuing without skills",
      {
        endpointId: message.endpointId,
        transport: message.conversation.transport,
        conversationId: message.conversation.externalId,
        messageId: message.messageId,
        correlationId: message.correlationId,
        agentId: childAgent.id,
      },
      error,
    );
    return [];
  }
}

function createNestedMessage(
  parentMessage: IncomingMessage,
  toolCallId: string,
  text: string,
): IncomingMessage {
  const receivedAt = new Date().toISOString();

  return {
    endpointId: parentMessage.endpointId,
    conversation: parentMessage.conversation,
    messageId: `${parentMessage.messageId}:delegate:${toolCallId}:${randomUUID()}`,
    correlationId: `${parentMessage.correlationId}:delegate:${toolCallId}`,
    userId: parentMessage.userId,
    text,
    receivedAt,
  };
}

function createNestedConversation(
  parentConversation: ConversationContext,
  childAgentId: string,
  now: string,
): ConversationContext {
  return {
    state: {
      conversation: {
        ...parentConversation.state.conversation,
        agentId: childAgentId,
      },
      agentId: childAgentId,
      createdAt: now,
      updatedAt: now,
    },
    messages: [],
  };
}
