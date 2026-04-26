import { randomUUID } from "node:crypto";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition, AgentDelegationConfig } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
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
          ...(runtime?.availableSkills ? { availableSkills: runtime.availableSkills } : {}),
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

function createNestedMessage(
  parentMessage: IncomingMessage,
  toolCallId: string,
  text: string,
): IncomingMessage {
  const receivedAt = new Date().toISOString();

  return {
    ...parentMessage,
    messageId: `${parentMessage.messageId}:delegate:${toolCallId}:${randomUUID()}`,
    correlationId: `${parentMessage.correlationId}:delegate:${toolCallId}`,
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
