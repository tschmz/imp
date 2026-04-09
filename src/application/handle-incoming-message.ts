import { loadAppConfig } from "../config/load-app-config.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { readRecentLogLines } from "../logging/view-logs.js";
import { selectRelevantSkills } from "../skills/selection.js";
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
      const response = await dependencies.engine.run({
        agent,
        conversation,
        message,
        runtime: {
          configPath: dependencies.runtimeInfo.configPath,
          dataRoot: dependencies.runtimeInfo.dataRoot,
          ...(resolveActivatedSkills(message.text, dependencies)),
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
          toAssistantConversationMessage(
            response.message,
            message.messageId,
            respondedAt,
            message.correlationId,
          ),
        ],
      });

      return response.message;
    },
  };
}

function resolveActivatedSkills(
  userText: string,
  dependencies: HandleIncomingMessageDependencies,
): { activatedSkills?: NonNullable<HandleIncomingMessageDependencies["skillCatalog"]> } {
  const skillCatalog = dependencies.skillCatalog ?? [];
  if (skillCatalog.length === 0) {
    return {};
  }

  try {
    const activatedSkills = selectRelevantSkills(userText, skillCatalog, 3);
    return activatedSkills.length > 0 ? { activatedSkills } : {};
  } catch (error) {
    void dependencies.logger?.error(
      "failed to select bot skills; continuing without skill activation",
      {
        botId: dependencies.runtimeInfo.botId,
      },
      error,
    );
    return {};
  }
}

function toUserConversationMessage(message: IncomingMessage) {
  return {
    id: message.messageId,
    role: "user" as const,
    text: message.text,
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
    ...(message.source ? { source: message.source } : {}),
  };
}

function toAssistantConversationMessage(
  message: OutgoingMessage,
  parentMessageId: string,
  createdAt: string,
  correlationId: string,
) {
  return {
    id: `${parentMessageId}:assistant`,
    role: "assistant" as const,
    text: message.text,
    createdAt,
    correlationId,
  };
}
