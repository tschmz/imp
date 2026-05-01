import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import {
  renderAgentMessage,
  renderAgentSwitchMessage,
  renderUnknownAgentMessage,
} from "./renderers.js";
import type {
  AgentRuntimeCommandSurface,
  InboundCommandContext,
  InboundCommandHandler,
} from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export const agentCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "agent",
    description: "Show or change the session agent",
    usage: "/agent [id]",
    helpGroup: "Context",
  },
  canHandle(command) {
    return command === "agent";
  },
  async handle({ message, dependencies, loadAppConfig, logger }: InboundCommandContext) {
    const requestedAgentId = normalizeCommandArgument(message.commandArgs);
    const runtimeAgentIds = dependencies.agentRegistry.list().map((agent) => agent.id);
    const availableAgentIds = await resolveAvailableAgentIds({
      runtimeAgentIds,
      context: { message, dependencies, logger },
      loadAppConfig,
    });

    if (!requestedAgentId) {
      const selectedAgentId =
        await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
        dependencies.defaultAgentId;
      const activeAgent =
        dependencies.agentRegistry.get(selectedAgentId) ??
        dependencies.agentRegistry.get(dependencies.defaultAgentId)!;
      const conversation =
        await dependencies.conversationStore.getActiveForAgent?.(activeAgent.id)
        ?? await dependencies.conversationStore.get(message.conversation);
      const runtimeSurface = await resolveAgentRuntimeSurface({
        agent: activeAgent,
        conversation,
        context: { message, dependencies, logger },
      });

      return {
        conversation: {
          ...message.conversation,
          agentId: activeAgent.id,
        },
        text: renderAgentMessage(activeAgent, {
          currentAgentId: activeAgent.id,
          availableAgentIds,
          runtimeTools: runtimeSurface?.tools,
          runtimeSkills: runtimeSurface?.skills,
        }),
      };
    }

    const requestedAgent = dependencies.agentRegistry.get(requestedAgentId);
    if (!requestedAgent) {
      const configuredButNotLoaded = availableAgentIds.includes(requestedAgentId);
      return {
        conversation: message.conversation,
        text: renderUnknownAgentMessage(requestedAgentId, availableAgentIds, {
          configuredButNotLoaded,
        }),
      };
    }

    const ensureActive = dependencies.conversationStore.ensureActiveForAgent ?? dependencies.conversationStore.ensureActive;
    const conversation = await ensureActive(message.conversation, {
      agentId: requestedAgent.id,
      now: message.receivedAt,
    });
    const runtimeSurface = await resolveAgentRuntimeSurface({
      agent: requestedAgent,
      conversation,
      context: { message, dependencies, logger },
    });
    await logger?.debug("selected agent for surface", {
      endpointId: message.endpointId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      agentId: requestedAgent.id,
    });

    return {
      conversation: {
        ...message.conversation,
        ...(conversation.state.conversation.sessionId
          ? { sessionId: conversation.state.conversation.sessionId }
          : {}),
        agentId: requestedAgent.id,
      },
      text: renderAgentSwitchMessage(requestedAgent, {
        runtimeTools: runtimeSurface?.tools,
        runtimeSkills: runtimeSurface?.skills,
      }),
    };
  },
};

async function resolveAgentRuntimeSurface(options: {
  agent: AgentDefinition;
  conversation?: ConversationContext;
  context: Pick<InboundCommandContext, "message" | "dependencies" | "logger">;
}): Promise<AgentRuntimeCommandSurface | undefined> {
  const resolver = options.context.dependencies.resolveAgentRuntimeSurface;
  if (!resolver) {
    return undefined;
  }

  try {
    return await resolver({
      agent: options.agent,
      conversation: options.conversation,
      message: options.context.message,
      runtimeInfo: options.context.dependencies.runtimeInfo,
    });
  } catch (error) {
    await options.context.logger?.debug("failed to resolve runtime surface for /agent", {
      endpointId: options.context.message.endpointId,
      transport: options.context.message.conversation.transport,
      conversationId: options.context.message.conversation.externalId,
      messageId: options.context.message.messageId,
      correlationId: options.context.message.correlationId,
      agentId: options.agent.id,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}


async function resolveAvailableAgentIds(options: {
  runtimeAgentIds: string[];
  context: Pick<InboundCommandContext, "message" | "dependencies" | "logger">;
  loadAppConfig: InboundCommandContext["loadAppConfig"];
}): Promise<string[]> {
  const agentIds = new Set(options.runtimeAgentIds);

  try {
    const appConfig = await options.loadAppConfig(options.context.dependencies.runtimeInfo.configPath);
    const { resolveRuntimeConfig } = await import("../../config/resolve-runtime-config.js");
    const runtimeConfig = await resolveRuntimeConfig(appConfig, options.context.dependencies.runtimeInfo.configPath, {
      includeCliEndpoints: true,
    });
    for (const agent of runtimeConfig.agents) {
      agentIds.add(agent.id);
    }
  } catch (error) {
    await options.context.logger?.debug("failed to resolve configured agents for /agent", {
      endpointId: options.context.message.endpointId,
      conversationId: options.context.message.conversation.externalId,
      messageId: options.context.message.messageId,
      correlationId: options.context.message.correlationId,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return [...agentIds];
}
