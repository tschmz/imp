import { randomUUID } from "node:crypto";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition, AgentDelegationConfig } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import { resolveEffectiveSkills } from "../skills/resolve-effective-skills.js";
import type { ConversationStore } from "../storage/types.js";
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
    conversationStore?: ConversationStore;
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
    conversationStore?: ConversationStore;
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
      resume: {
        type: "string",
        minLength: 1,
        description:
          "Optional delegated agent session id to continue. When missing, the delegated run is stateless.",
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

      const receivedAt = new Date().toISOString();
      const nestedConversation = childInput.resume
        ? await resolveResumableNestedConversation(
            dependencies.conversationStore,
            conversation,
            childAgent.id,
            childInput.resume,
            receivedAt,
            delegation.toolName,
          )
        : createNestedConversation(conversation, childAgent.id, receivedAt);
      const nestedMessage = createNestedMessage(
        parentMessage,
        toolCallId,
        childInput.input,
        nestedConversation.state.conversation,
      );
      const childSkills = await resolveDelegatedAgentSkills(childAgent, nestedConversation, runtime, dependencies.logger, nestedMessage);

      await dependencies.logger?.debug("starting delegated agent run", {
        agentId: childAgent.id,
        ...(childInput.resume ? { sessionId: childInput.resume } : {}),
        messageId: nestedMessage.messageId,
        correlationId: nestedMessage.correlationId,
      });

      const result = await runNestedAgent({
        parentAgent,
        delegation,
        childAgent,
        nestedConversation,
        nestedMessage,
        runtime,
        currentDepth,
        parentMessage,
        childSkills,
        conversationStore: childInput.resume ? dependencies.conversationStore : undefined,
        runDelegatedAgent: dependencies.runDelegatedAgent,
      });

      await dependencies.logger?.debug("completed delegated agent run", {
        agentId: childAgent.id,
        ...(childInput.resume ? { sessionId: childInput.resume } : {}),
        messageId: nestedMessage.messageId,
        correlationId: nestedMessage.correlationId,
      });

      return {
        content: [{ type: "text", text: result.message.text }],
        details: {
          delegatedAgentId: childAgent.id,
          toolName: delegation.toolName,
          ...(childInput.resume ? { sessionId: childInput.resume } : {}),
        },
      };
    },
  };
}

function parseDelegationParams(toolName: string, params: unknown): { input: string; resume?: string } {
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

  const resume = "resume" in params ? params.resume : undefined;
  if (resume !== undefined && (typeof resume !== "string" || resume.length === 0)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `${toolName} resume must be a non-empty string session id when provided.`,
    );
  }

  return {
    input,
    ...(resume ? { resume } : {}),
  };
}

async function resolveResumableNestedConversation(
  conversationStore: ConversationStore | undefined,
  parentConversation: ConversationContext,
  childAgentId: string,
  sessionId: string,
  now: string,
  toolName: string,
): Promise<ConversationContext> {
  if (!conversationStore?.ensureDetachedForAgent) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `${toolName} cannot resume delegated agent sessions because the runtime store does not support detached sessions.`,
    );
  }

  return conversationStore.ensureDetachedForAgent(
    {
      transport: parentConversation.state.conversation.transport,
      externalId: parentConversation.state.conversation.externalId,
      sessionId,
    },
    {
      agentId: childAgentId,
      now,
      kind: "delegated",
      metadata: {
        toolName,
      },
    },
  );
}

async function runNestedAgent(input: {
  parentAgent: AgentDefinition;
  delegation: AgentDelegationConfig;
  childAgent: AgentDefinition;
  nestedConversation: ConversationContext;
  nestedMessage: IncomingMessage;
  runtime: AgentRunRuntimeContext | undefined;
  currentDepth: number;
  parentMessage: IncomingMessage;
  childSkills: Awaited<ReturnType<typeof resolveDelegatedAgentSkills>>;
  conversationStore?: ConversationStore;
  runDelegatedAgent: AgentEngine["run"];
}) {
  const startedAt = new Date().toISOString();
  let persistedConversation = input.nestedConversation;
  const persistedEventIds = new Set(persistedConversation.messages.map((event) => event.id));

  if (input.conversationStore) {
    persistedConversation = await updateDelegatedConversationState(
      input.conversationStore,
      persistedConversation,
      {
        updatedAt: startedAt,
        run: {
          status: "running",
          messageId: input.nestedMessage.messageId,
          correlationId: input.nestedMessage.correlationId,
          startedAt,
          updatedAt: startedAt,
        },
      },
    );
    persistedConversation = await appendDelegatedConversationEvents(
      input.conversationStore,
      persistedConversation,
      [toUserConversationMessage(input.nestedMessage)],
    );
    persistedEventIds.add(input.nestedMessage.messageId);
  }

  try {
    const result = await input.runDelegatedAgent({
      agent: input.childAgent,
      conversation: input.nestedConversation,
      message: input.nestedMessage,
      onConversationEvents: input.conversationStore
        ? async (events) => {
            persistedConversation = await appendDelegatedConversationEvents(
              input.conversationStore!,
              persistedConversation,
              events,
            );
            for (const event of events) {
              persistedEventIds.add(event.id);
            }
          }
        : undefined,
      onSystemPromptResolved: input.conversationStore?.writeSystemPromptSnapshot
        ? async (snapshot) => {
            await input.conversationStore!.writeSystemPromptSnapshot!(
              persistedConversation,
              snapshot,
            );
          }
        : undefined,
      runtime: {
        ...(input.runtime?.configPath ? { configPath: input.runtime.configPath } : {}),
        ...(input.runtime?.dataRoot ? { dataRoot: input.runtime.dataRoot } : {}),
        ...(input.childSkills.length > 0 ? { availableSkills: input.childSkills } : {}),
        invocation: {
          kind: "delegated",
          parentAgentId: input.parentAgent.id,
          toolName: input.delegation.toolName,
        },
        ingress: input.runtime?.ingress ?? {
          endpointId: input.parentMessage.endpointId,
          transportKind: input.parentMessage.conversation.transport,
        },
        output: {
          mode: "delegated-tool",
        },
        delegationDepth: input.currentDepth + 1,
      },
    });

    if (input.conversationStore) {
      const unpersistedEvents = result.conversationEvents.filter((event) => !persistedEventIds.has(event.id));
      if (unpersistedEvents.length > 0) {
        persistedConversation = await appendDelegatedConversationEvents(
          input.conversationStore,
          persistedConversation,
          unpersistedEvents,
        );
        for (const event of unpersistedEvents) {
          persistedEventIds.add(event.id);
        }
      }

      const completedAt = new Date().toISOString();
      await updateDelegatedConversationState(input.conversationStore, persistedConversation, {
        ...(result.workingDirectory ? { workingDirectory: result.workingDirectory } : {}),
        updatedAt: completedAt,
        run: {
          status: "idle",
          updatedAt: completedAt,
        },
      });
    }

    return result;
  } catch (error: unknown) {
    if (input.conversationStore) {
      const failedAt = new Date().toISOString();
      await updateDelegatedConversationState(input.conversationStore, persistedConversation, {
        updatedAt: failedAt,
        run: {
          status: "failed",
          messageId: input.nestedMessage.messageId,
          correlationId: input.nestedMessage.correlationId,
          startedAt,
          updatedAt: failedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    throw toUserVisibleToolError(error, {
      fallbackMessage: `Delegated agent "${input.childAgent.id}" failed.`,
      defaultKind: "tool_command_execution",
    });
  }
}

async function appendDelegatedConversationEvents(
  conversationStore: ConversationStore,
  conversation: ConversationContext,
  events: ConversationContext["messages"],
): Promise<ConversationContext> {
  return conversationStore.appendEvents
    ? conversationStore.appendEvents(conversation, events)
    : {
        ...conversation,
        messages: [...conversation.messages, ...events],
      };
}

async function updateDelegatedConversationState(
  conversationStore: ConversationStore,
  conversation: ConversationContext,
  patch: Partial<ConversationContext["state"]>,
): Promise<ConversationContext> {
  return conversationStore.updateState
    ? conversationStore.updateState(conversation, patch)
    : {
        ...conversation,
        state: {
          ...conversation.state,
          ...patch,
        },
      };
}

function toUserConversationMessage(message: IncomingMessage): ConversationContext["messages"][number] {
  return {
    kind: "message",
    id: message.messageId,
    role: "user",
    content: message.text,
    timestamp: Date.parse(message.receivedAt),
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
    ...(message.source ? { source: message.source } : {}),
  };
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
  conversation: IncomingMessage["conversation"],
): IncomingMessage {
  const receivedAt = new Date().toISOString();

  return {
    endpointId: parentMessage.endpointId,
    conversation,
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
