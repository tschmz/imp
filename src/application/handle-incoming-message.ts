import { loadAppConfig } from "../config/load-app-config.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { readRecentLogLines } from "../logging/view-logs.js";
import { createHookRunner } from "../extensions/hook-runner.js";
import { inboundCommandHandlers } from "./commands/registry.js";
import type { HandleIncomingMessageDependencies } from "./commands/types.js";
import { dispatchCommand } from "./inbound/dispatch-command.js";
import { executeAgent } from "./inbound/execute-agent.js";
import { persistConversation } from "./inbound/persist-conversation.js";
import { resolveConversation } from "./inbound/resolve-conversation.js";
import { resolveSkills } from "./inbound/resolve-skills.js";
import { runHooksStart } from "./inbound/run-hooks-start.js";
import { runHooksError, runHooksSuccess } from "./inbound/run-hooks-success-error.js";
import type { InboundProcessingContext } from "./inbound/types.js";

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
  const hookRunner = createHookRunner(dependencies.inboundMessageHooks, {
    logger: dependencies.logger,
  });

  if (!defaultAgent) {
    throw new Error(`Unknown default agent: ${dependencies.defaultAgentId}`);
  }

  return {
    async handle(message: IncomingMessage): Promise<OutgoingMessage> {
      const context: InboundProcessingContext = {
        message,
        dependencies,
        defaultAgent,
        availableCommands,
        loadAppConfig: loadAppConfigImpl,
        readRecentLogLines: readRecentLogLinesImpl,
        hookRunner,
        startedAt: Date.now(),
        availableSkills: [],
      };

      try {
        await runHooksStart(context);
        await dispatchCommand(context);
        await resolveConversation(context);
        await resolveSkills(context);
        await executeAgent(context);
        await persistConversation(context);
        await runHooksSuccess(context);

        if (!context.response) {
          throw new Error("Inbound processing completed without a response");
        }

        return context.response;
      } catch (error) {
        await runHooksError(context, error);
        throw error;
      }
    },
  };
}
