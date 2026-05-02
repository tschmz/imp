import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext, ConversationEvent } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { ReplyChannelContext } from "../runtime/context.js";
import type { DeliveryRouter } from "../transports/delivery-router.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";

export async function recoverInterruptedRuns(
  runtime: BootstrappedRuntime,
  dependencies: {
    agentRegistry: AgentRegistry;
    deliveryRouter: DeliveryRouter;
    replyChannel: ReplyChannelContext;
  },
): Promise<void> {
  const interruptedRuns = await runtime.conversationStore.listInterruptedRuns?.() ?? [];
  let recoveredRunCount = 0;

  for (const conversation of interruptedRuns) {
    const lastMessage = conversation.messages.at(-1);
    if (!lastMessage || !isSafelyContinuable(lastMessage)) {
      continue;
    }

    const agent = dependencies.agentRegistry.get(conversation.state.agentId);
    if (!agent) {
      continue;
    }

    const parentMessageId = getRecoveryParentMessageId(conversation, lastMessage);
    if (!parentMessageId) {
      continue;
    }

    try {
      await continueInterruptedRun(runtime, dependencies, agent, conversation, parentMessageId);
      recoveredRunCount += 1;
    } catch (error) {
      await runtime.logger.error("failed to continue interrupted conversation run", {
        endpointId: runtime.endpointConfig.id,
        agentId: conversation.state.agentId,
        conversationId: conversation.state.conversation.externalId,
        messageId: parentMessageId,
        errorType: error instanceof Error ? error.name : typeof error,
      }, error);
    }
  }

  if (recoveredRunCount > 0) {
    await runtime.logger.info("continued interrupted conversation runs", {
      endpointId: runtime.endpointConfig.id,
      interruptedRunCount: recoveredRunCount,
    });
  }
}

async function continueInterruptedRun(
  runtime: BootstrappedRuntime,
  dependencies: {
    deliveryRouter: DeliveryRouter;
    replyChannel: ReplyChannelContext;
  },
  agent: AgentDefinition,
  conversation: ConversationContext,
  parentMessageId: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  let persistedConversation = await runtime.conversationStore.updateState?.(conversation, {
    updatedAt: startedAt,
    run: {
      status: "running",
      messageId: parentMessageId,
      correlationId: conversation.state.run?.correlationId,
      startedAt: conversation.state.run?.startedAt ?? startedAt,
      updatedAt: startedAt,
    },
  }) ?? conversation;

  const message = createRecoveryMessage(runtime, persistedConversation, parentMessageId, startedAt);
  const result = await runtime.engine.run({
    agent,
    conversation: persistedConversation,
    message,
    continueFromContext: true,
    onConversationEvents: runtime.conversationStore.appendEvents
      ? async (events) => {
          persistedConversation = await runtime.conversationStore.appendEvents!(
            persistedConversation,
            events,
          );
        }
      : undefined,
    onSystemPromptResolved: runtime.conversationStore.writeSystemPromptSnapshot
      ? async (snapshot) => {
          await runtime.conversationStore.writeSystemPromptSnapshot!(
            persistedConversation,
            snapshot,
          );
        }
      : undefined,
    runtime: {
      configPath: runtime.configPath,
      dataRoot: runtime.endpointConfig.paths.dataRoot,
      invocation: {
        kind: "direct",
      },
      ingress: {
        endpointId: message.endpointId,
        transportKind: message.conversation.transport,
      },
      output: {
        mode: "reply-channel",
        replyChannel: dependencies.replyChannel,
      },
      replyChannel: dependencies.replyChannel,
    },
  });
  const completedAt = new Date().toISOString();
  const finalConversation: ConversationContext = {
    state: {
      ...persistedConversation.state,
      ...(result.workingDirectory ? { workingDirectory: result.workingDirectory } : {}),
      updatedAt: completedAt,
      run: {
        status: "idle",
        updatedAt: completedAt,
      },
    },
    messages: mergeConversationEvents(persistedConversation.messages, result.conversationEvents),
  };

  await runtime.conversationStore.put(finalConversation);
  await deliverRecoveredMessage(runtime, dependencies.deliveryRouter, result.message);
}

async function deliverRecoveredMessage(
  runtime: BootstrappedRuntime,
  deliveryRouter: DeliveryRouter,
  message: Awaited<ReturnType<BootstrappedRuntime["engine"]["run"]>>["message"],
): Promise<void> {
  try {
    await deliveryRouter.deliver({
      endpointId: runtime.endpointConfig.id,
      target: {
        conversationId: message.conversation.externalId,
      },
      message,
    });
  } catch (error) {
    await runtime.logger.debug("skipped recovered response delivery", {
      endpointId: runtime.endpointConfig.id,
      conversationId: message.conversation.externalId,
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
}

function createRecoveryMessage(
  runtime: BootstrappedRuntime,
  conversation: ConversationContext,
  parentMessageId: string,
  receivedAt: string,
): IncomingMessage {
  const lastMessage = conversation.messages.at(-1);
  return {
    endpointId: runtime.endpointConfig.id,
    conversation: {
      ...conversation.state.conversation,
      endpointId: runtime.endpointConfig.id,
    },
    messageId: parentMessageId,
    correlationId: conversation.state.run?.correlationId ?? `${parentMessageId}:recovery`,
    userId: conversation.state.conversation.externalId,
    text: lastMessage?.role === "user" ? renderRecoveryUserText(lastMessage.content) : "",
    receivedAt,
    ...(lastMessage?.role === "user" && lastMessage.source ? { source: lastMessage.source } : {}),
  };
}

function renderRecoveryUserText(content: ConversationEvent["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function isSafelyContinuable(message: ConversationEvent): boolean {
  return message.role === "user" || message.role === "toolResult";
}

function getRecoveryParentMessageId(
  conversation: ConversationContext,
  lastMessage: ConversationEvent,
): string | undefined {
  if (conversation.state.run?.messageId) {
    return conversation.state.run.messageId;
  }

  if (lastMessage.role === "user") {
    return lastMessage.id;
  }

  const marker = ":tool-result:";
  const markerIndex = lastMessage.id.indexOf(marker);
  return markerIndex >= 0 ? lastMessage.id.slice(0, markerIndex) : undefined;
}

function mergeConversationEvents(
  existing: ConversationEvent[],
  incoming: ConversationEvent[],
): ConversationEvent[] {
  const merged = [...existing];
  const seen = new Set(existing.map((event) => event.id));
  for (const event of incoming) {
    if (!seen.has(event.id)) {
      seen.add(event.id);
      merged.push(event);
    }
  }
  return merged;
}
