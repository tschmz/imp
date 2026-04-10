import { loadAppConfig } from "../config/load-app-config.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { readRecentLogLines } from "../logging/view-logs.js";
import { getOrCreateConversationContext } from "./commands/conversation-context.js";
import { inboundCommandHandlers } from "./commands/registry.js";
import type { HandleIncomingMessageDependencies } from "./commands/types.js";

export type { HandleIncomingMessageDependencies, RuntimeCommandInfo } from "./commands/types.js";

export interface HandleIncomingMessage {
  handle(message: IncomingMessage): Promise<OutgoingMessage>;
}

export function createHandleIncomingMessage(
  dependencies: HandleIncomingMessageDependencies,
): HandleIncomingMessage {
  const defaultAgent = dependencies.agentRegistry.get(dependencies.defaultAgentId);
  const availableCommands = dependencies.availableCommands ?? inboundCommandHandlers;
  const loadAppConfigImpl = dependencies.loadAppConfig ?? loadAppConfig;
  const readRecentLogLinesImpl = dependencies.readRecentLogLines ?? readRecentLogLines;

  if (!defaultAgent) {
    throw new Error(`Unknown default agent: ${dependencies.defaultAgentId}`);
  }

  return {
    async handle(message: IncomingMessage): Promise<OutgoingMessage> {
      if (message.command) {
        const handler = availableCommands.find((candidate) => candidate.canHandle(message.command));
        if (handler) {
          const commandResponse = await handler.handle({
            message,
            dependencies: {
              ...dependencies,
              availableCommands,
            },
            logger: dependencies.logger,
            loadAppConfig: loadAppConfigImpl,
            readRecentLogLines: readRecentLogLinesImpl,
          });
          if (commandResponse) {
            return commandResponse;
          }
        }
      }

      const conversation = await getOrCreateConversationContext(
        message,
        defaultAgent.id,
        dependencies.conversationStore,
        dependencies.logger,
      );
      const agent = dependencies.agentRegistry.get(conversation.state.agentId) ?? defaultAgent;
      await dependencies.logger?.debug("resolved conversation context", {
        botId: message.botId,
        transport: message.conversation.transport,
        conversationId: message.conversation.externalId,
        messageId: message.messageId,
        correlationId: message.correlationId,
        agentId: agent.id,
      });
      const activatedSkills = await resolveActivatedSkills(message, agent, dependencies);
      const response = await dependencies.engine.run({
        agent,
        conversation,
        message,
        runtime: {
          configPath: dependencies.runtimeInfo.configPath,
          dataRoot: dependencies.runtimeInfo.dataRoot,
          ...(activatedSkills.length > 0 ? { activatedSkills } : {}),
        },
      });
      const respondedAt = new Date().toISOString();

      await dependencies.conversationStore.put({
        state: {
          ...conversation.state,
          ...(response.workingDirectory ? { workingDirectory: response.workingDirectory } : {}),
          updatedAt: respondedAt,
        },
        messages: [
          ...conversation.messages,
          toUserConversationMessage(message),
          ...response.conversationEvents,
        ],
      });

      return response.message;
    },
  };
}

async function resolveActivatedSkills(
  message: IncomingMessage,
  agent: NonNullable<ReturnType<HandleIncomingMessageDependencies["agentRegistry"]["get"]>>,
  dependencies: HandleIncomingMessageDependencies,
): Promise<NonNullable<HandleIncomingMessageDependencies["skillCatalog"]>> {
  const skillCatalog = dependencies.skillCatalog ?? [];
  const skillSelector = dependencies.skillSelector;
  if (skillCatalog.length === 0 || !skillSelector) {
    return [];
  }

  try {
    const activatedSkills = await skillSelector.selectRelevantSkills({
      agent,
      userText: message.text,
      catalog: skillCatalog,
      maxActivatedSkills: 3,
    });
    const logFields = {
      botId: message.botId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      agentId: agent.id,
      skillCount: activatedSkills.length,
      skillNames: activatedSkills.map((skill) => skill.name),
    };
    if (activatedSkills.length > 0) {
      await dependencies.logger?.info("resolved bot skills for turn", logFields);
    } else {
      await dependencies.logger?.debug("resolved bot skills for turn", logFields);
    }
    return activatedSkills;
  } catch (error) {
    void dependencies.logger?.error(
      "failed to select bot skills; continuing without skill activation",
      {
        botId: message.botId,
        transport: message.conversation.transport,
        conversationId: message.conversation.externalId,
        messageId: message.messageId,
        correlationId: message.correlationId,
        agentId: agent.id,
      },
      error,
    );
    return [];
  }
}

function toUserConversationMessage(message: IncomingMessage) {
  return {
    kind: "message" as const,
    id: message.messageId,
    role: "user" as const,
    text: message.text,
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
    ...(message.source ? { source: message.source } : {}),
  };
}
