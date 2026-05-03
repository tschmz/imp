import { loadAppConfig } from "../config/load-app-config.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { readRecentLogLines } from "../logging/view-logs.js";
import type { MidRunMessageSource } from "../runtime/context.js";
import { createHookRunner } from "../extensions/hook-runner.js";
import { inboundCommandHandlers } from "./commands/registry.js";
import type { HandleIncomingMessageDependencies } from "./commands/types.js";
import { dispatchCommand } from "./inbound/dispatch-command.js";
import { executeAgent } from "./inbound/execute-agent.js";
import { compactConversationIfNeeded } from "./inbound/compact-conversation.js";
import { persistConversation } from "./inbound/persist-conversation.js";
import { markResponseSuppressedWhenStale } from "./inbound/response-delivery.js";
import { resolveConversation } from "./inbound/resolve-conversation.js";
import { resolveSkills } from "./inbound/resolve-skills.js";
import { runHooksStart } from "./inbound/run-hooks-start.js";
import { runHooksError, runHooksSuccess } from "./inbound/run-hooks-success-error.js";
import {
  createInboundProcessingContext,
  hasResponse,
  type InboundProcessingContext,
} from "./inbound/types.js";

export type { HandleIncomingMessageDependencies, RuntimeCommandInfo } from "./commands/types.js";

export interface HandleIncomingMessage {
  handle(
    message: IncomingMessage,
    options?: {
      deliverProgress?: (message: OutgoingMessage) => Promise<void> | void;
      midRunMessages?: MidRunMessageSource;
    },
  ): Promise<OutgoingMessage>;
}

export function createHandleIncomingMessage(
  dependencies: HandleIncomingMessageDependencies,
): HandleIncomingMessage {
  const defaultAgent = dependencies.agentRegistry.get(dependencies.defaultAgentId);
  const availableCommands = dependencies.availableCommands ?? inboundCommandHandlers;
  const loadAppConfigImpl = dependencies.loadAppConfig ?? loadAppConfig;
  const readRecentLogLinesImpl = dependencies.readRecentLogLines ?? readRecentLogLines;
  const hookRunner = createHookRunner(dependencies.inboundMessageHooks, {
    logger: dependencies.logger,
  });

  if (!defaultAgent) {
    throw new Error(`Unknown default agent: ${dependencies.defaultAgentId}`);
  }

  return {
    async handle(
      message: IncomingMessage,
      options: {
        deliverProgress?: (message: OutgoingMessage) => Promise<void> | void;
        midRunMessages?: MidRunMessageSource;
      } = {},
    ): Promise<OutgoingMessage> {
      const context = createInboundProcessingContext({
        message,
        dependencies,
        defaultAgent,
        availableCommands,
        loadAppConfig: loadAppConfigImpl,
        readRecentLogLines: readRecentLogLinesImpl,
        hookRunner,
        startedAt: Date.now(),
        deliverProgress: options.deliverProgress,
        midRunMessages: options.midRunMessages,
      });
      let activeContext: InboundProcessingContext = context;

      try {
        await runHooksStart(context);
        const commandContext = await dispatchCommand(context);
        activeContext = commandContext;
        if (hasResponse(commandContext)) {
          await runHooksSuccess(commandContext);
          return commandContext.response;
        }

        const resolvedContext = await resolveConversation(commandContext);
        activeContext = resolvedContext;
        const contextWithSkills = await resolveSkills(resolvedContext);
        activeContext = contextWithSkills;
        const compactedContext = await compactConversationIfNeeded(contextWithSkills);
        activeContext = compactedContext;
        const responseContext = await executeAgent(compactedContext);
        activeContext = responseContext;
        const persistedContext = await persistConversation(responseContext);
        activeContext = persistedContext;
        const deliveryResponse = await markResponseSuppressedWhenStale(persistedContext.response, {
          store: dependencies.conversationStore,
          ref: message.conversation,
          conversation: persistedContext.conversation,
          defaultAgentId: defaultAgent.id,
        });
        await runHooksSuccess(persistedContext);

        return deliveryResponse;
      } catch (error) {
        await runHooksError(activeContext, error);
        throw error;
      }
    },
  };
}
