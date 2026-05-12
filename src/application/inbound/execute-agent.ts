import type { ConversationEvent } from "../../domain/conversation.js";
import { getAssistantCommentaryText } from "../../runtime/message-mapping.js";
import { AgentExecutionError } from "../../runtime/agent-execution.js";
import type { AgentRunResult } from "../../runtime/context.js";
import { toUserConversationMessage } from "./incoming-message-event.js";
import { getResponseDeliverySelectionRef, isConversationStillSelected } from "./response-delivery.js";
import {
  type ResolvedHandledInboundProcessingContext,
  type ResolvedInboundProcessingContext,
  withConversation,
  withResponse,
} from "./types.js";

const maxAgentRunAttempts = 2;

export async function executeAgent(
  context: ResolvedInboundProcessingContext,
): Promise<ResolvedHandledInboundProcessingContext> {
  const conversationBeforeRun = context.conversation;
  const userConversationMessage = toUserConversationMessage(context.message);
  let persistedConversation = context.conversation;
  const midRunUserMessages: ConversationEvent[] = [];
  const startedAt = new Date().toISOString();
  if (context.dependencies.conversationStore.updateState) {
    persistedConversation = await context.dependencies.conversationStore.updateState(
      persistedConversation,
      {
        updatedAt: startedAt,
        run: {
          status: "running",
          messageId: context.message.messageId,
          correlationId: context.message.correlationId,
          startedAt,
          updatedAt: startedAt,
        },
      },
    );
  }

  if (context.dependencies.conversationStore.appendEvents) {
    persistedConversation = await context.dependencies.conversationStore.appendEvents(
      persistedConversation,
      [userConversationMessage],
    );
  }
  const conversationWithUserMessage = persistedConversation;

  let result: AgentRunResult | undefined;
  for (let attempt = 1; attempt <= maxAgentRunAttempts; attempt++) {
    try {
      const replyChannel = resolveMessageReplyChannel(context);
      result = await context.dependencies.engine.run({
        agent: context.agent,
        conversation: conversationBeforeRun,
        message: context.message,
        onConversationEvents: async (events) => {
          if (context.dependencies.conversationStore.appendEvents) {
            persistedConversation = await context.dependencies.conversationStore.appendEvents(
              persistedConversation,
              events,
            );
          }

          await deliverProgressUpdates(context, events, replyChannel);
        },
        midRunMessages: context.midRunMessages,
        onMidRunMessageInjected: async (message) => {
          const event = toUserConversationMessage(message);
          if (context.dependencies.conversationStore.appendEvents) {
            persistedConversation = await context.dependencies.conversationStore.appendEvents(
              persistedConversation,
              [event],
            );
          }
          midRunUserMessages.push(event);
        },
        onSystemPromptResolved: context.dependencies.conversationStore.writeSystemPromptSnapshot
          ? async (snapshot) => {
            await context.dependencies.conversationStore.writeSystemPromptSnapshot!(
              persistedConversation,
              snapshot,
            );
          }
          : undefined,
        runtime: {
          configPath: context.dependencies.runtimeInfo.configPath,
          dataRoot: context.dependencies.runtimeInfo.dataRoot,
          invocation: {
            kind: "direct",
          },
          ingress: {
            endpointId: context.message.endpointId,
            transportKind: context.message.conversation.transport,
          },
          output: {
            mode: "reply-channel",
            ...(replyChannel ? { replyChannel } : {}),
          },
          ...(replyChannel ? { replyChannel } : {}),
          ...(context.availableSkills.length > 0 ? { availableSkills: [...context.availableSkills] } : {}),
        },
      });
      break;
    } catch (error) {
      if (shouldRetryAgentRun(error, attempt)) {
        await context.dependencies.logger?.info("retrying agent run after transient provider failure", {
          event: "agent.run.retrying",
          endpointId: context.message.endpointId,
          transport: context.message.conversation.transport,
          conversationId: context.message.conversation.externalId,
          messageId: context.message.messageId,
          correlationId: context.message.correlationId,
          agentId: context.agent.id,
          attempt,
          maxAttempts: maxAgentRunAttempts,
          errorType: error instanceof Error ? error.name : typeof error,
          ...(error instanceof AgentExecutionError
            ? {
                agentStopReason: error.details.stopReason,
                upstreamErrorMessage: error.details.upstreamErrorMessage,
                upstreamProvider: error.details.upstreamProvider,
                upstreamModel: error.details.upstreamModel,
                upstreamApi: error.details.upstreamApi,
                upstreamResponseId: error.details.upstreamResponseId,
              }
            : {}),
        });
        persistedConversation = conversationWithUserMessage;
        midRunUserMessages.length = 0;
        await context.dependencies.conversationStore.put(conversationWithUserMessage);
        continue;
      }

      const failedAt = new Date().toISOString();
      if (context.dependencies.conversationStore.updateState) {
        await context.dependencies.conversationStore.updateState(persistedConversation, {
          updatedAt: failedAt,
          run: {
            status: "failed",
            messageId: context.message.messageId,
            correlationId: context.message.correlationId,
            startedAt,
            updatedAt: failedAt,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    }
  }

  if (!result) {
    throw new Error(`Agent "${context.agent.id}" did not produce a result.`);
  }

  const completedAt = new Date().toISOString();
  const responseContext = withResponse(context, result.message);
  return withConversation(responseContext, {
    state: {
      ...context.conversation.state,
      ...(result.workingDirectory ? { workingDirectory: result.workingDirectory } : {}),
      updatedAt: completedAt,
      run: {
        status: "idle",
        updatedAt: completedAt,
      },
    },
    messages: [
      ...conversationBeforeRun.messages,
      userConversationMessage,
      ...midRunUserMessages,
      ...result.conversationEvents,
    ],
  });
}

function shouldRetryAgentRun(error: unknown, attempt: number): boolean {
  if (attempt >= maxAgentRunAttempts || !(error instanceof AgentExecutionError)) {
    return false;
  }

  return error.details.upstreamFailureKind === "temporary_availability"
    || error.details.upstreamFailureKind === "timeout"
    || isTerminatedProviderFailure(error);
}

function isTerminatedProviderFailure(error: AgentExecutionError): boolean {
  return /\bterminated\b/i.test(error.details.upstreamErrorMessage ?? error.message);
}

function resolveMessageReplyChannel(context: ResolvedInboundProcessingContext) {
  const response = context.message.source?.plugin?.metadata?.response;
  if (isResponseNoneOverride(response)) {
    return {
      kind: "none",
      delivery: "none" as const,
    };
  }

  return context.dependencies.runtimeInfo.replyChannel;
}

function isResponseNoneOverride(value: unknown): value is { type: "none" } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "none";
}

async function deliverProgressUpdates(
  context: ResolvedInboundProcessingContext,
  events: ConversationEvent[],
  replyChannel: ReturnType<typeof resolveMessageReplyChannel>,
): Promise<void> {
  if (!context.deliverProgress || replyChannel?.delivery === "none") {
    return;
  }

  const shouldDeliver = await isConversationStillSelected(
    context.dependencies.conversationStore,
    getResponseDeliverySelectionRef(context.message),
    context.conversation,
    context.defaultAgent.id,
  );
  if (!shouldDeliver) {
    return;
  }

  for (const event of events) {
    if (event.role !== "assistant") {
      continue;
    }

    const text = getAssistantCommentaryText(event);
    if (!text.trim()) {
      continue;
    }

    await context.deliverProgress({
      conversation: context.message.conversation,
      text,
    });
  }
}
