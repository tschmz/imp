import type { AgentOptions } from "@mariozechner/pi-agent-core";
import type { AgentDefinition } from "../../domain/agent.js";
import type { Logger } from "../../logging/types.js";
import type { AgentHandle } from "../agent-execution.js";
import { executeAgent } from "../agent-execution.js";
import type { AgentRunResult } from "../context.js";
import { resolvePreviousResponseState } from "../response-conversation-state.js";
import { createOnPayloadOverride } from "./resolve-tools-stage.js";
import type { ResolveToolsStageContext } from "./resolve-tools-stage.js";

export interface ExecuteAgentStageContext extends ResolveToolsStageContext {
  result: AgentRunResult;
}

export async function executeAgentStage(
  context: ResolveToolsStageContext,
  dependencies: {
    createAgent?: (options: AgentOptions) => AgentHandle;
    getApiKey?: (
      provider: string,
      agent: AgentDefinition,
    ) => Promise<string | undefined> | string | undefined;
    logger?: Logger;
    logContext?: {
      endpointId: string;
      transport: string;
      conversationId: string;
      messageId: string;
      correlationId: string;
      agentId: string;
    };
  },
): Promise<ExecuteAgentStageContext> {
  const previousResponseState = resolvePreviousResponseState(
    context.conversation.messages,
    context.model,
  );
  const result = await executeAgent({
    createAgent: dependencies.createAgent,
    getApiKey: dependencies.getApiKey,
    agent: context.agent,
    model: context.model,
    systemPrompt: context.systemPromptResolution.systemPrompt,
    tools: context.tools,
    message: context.input.message,
    conversationMessages: previousResponseState.conversationMessages,
    onPayload: createOnPayloadOverride(context.agent, {
      previousResponseId: previousResponseState.previousResponseId,
      onResolvedPayload: createResponsesPayloadLogger(dependencies.logger, dependencies.logContext),
    }),
    workingDirectoryState: context.workingDirectoryState,
    initialWorkingDirectory: context.initialWorkingDirectory,
    conversation: context.input.message.conversation,
    parentMessageId: context.input.message.messageId,
    correlationId: context.input.message.correlationId,
    replyChannel: context.input.runtime?.replyChannel,
    onConversationEvents: context.input.onConversationEvents,
    continueFromContext: context.input.continueFromContext,
    midRunMessages: context.input.midRunMessages,
    onMidRunMessageInjected: context.input.onMidRunMessageInjected,
  });

  return {
    ...context,
    result,
  };
}


function createResponsesPayloadLogger(
  logger: Logger | undefined,
  context:
    | {
        endpointId: string;
        transport: string;
        conversationId: string;
        messageId: string;
        correlationId: string;
        agentId: string;
      }
    | undefined,
): ((payload: Record<string, unknown>, model: { api: string }) => Promise<void>) | undefined {
  if (!logger || !context) {
    return undefined;
  }

  return async (payload, model) => {
    if (
      model.api !== "openai-responses"
      && model.api !== "openai-codex-responses"
      && model.api !== "azure-openai-responses"
    ) {
      return;
    }

    await logger.info("responses request payload", {
      event: "agent.request.responses.payload",
      component: "agent-engine",
      ...context,
      ...summarizeResponsesRequestPayload(payload),
    });
  };
}

function summarizeResponsesRequestPayload(payload: Record<string, unknown>): {
  requestModel?: string;
  requestStore?: boolean;
  requestPreviousResponseId?: string;
  requestInputCount?: number;
  requestToolCount?: number;
} {
  const input = payload.input;
  const tools = payload.tools;

  return {
    ...(typeof payload.model === "string" ? { requestModel: payload.model } : {}),
    ...(typeof payload.store === "boolean" ? { requestStore: payload.store } : {}),
    ...(typeof payload.previous_response_id === "string"
      ? { requestPreviousResponseId: payload.previous_response_id }
      : {}),
    ...(Array.isArray(input)
      ? { requestInputCount: input.length }
      : input === undefined
        ? {}
        : { requestInputCount: 1 }),
    ...(Array.isArray(tools) ? { requestToolCount: tools.length } : {}),
  };
}
