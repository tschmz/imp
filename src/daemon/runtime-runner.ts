import { parseInboundCommand } from "../application/commands/parse-inbound-command.js";
import { priorityInboundCommands } from "../application/commands/priority-inbound-commands.js";
import { createHandleIncomingMessage } from "../application/handle-incoming-message.js";
import { createMessageProcessor } from "../application/message-processor.js";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext, ConversationEvent } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import { createDeliveryRouter, type DeliveryRouter } from "../transports/delivery-router.js";
import type { ReplyChannelContext } from "../runtime/context.js";
import type { Transport, TransportContext, TransportFactory } from "../transports/types.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import type { RuntimeControlAction } from "./runtime-shutdown.js";
import type { ActiveEndpointRuntimeConfig } from "./types.js";
import type { ChatRef } from "../domain/conversation.js";

export interface RuntimeEntry {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface RuntimeRunnerDependencies {
  agentRegistry: ReturnType<typeof createAgentRegistry>;
  createTransport: TransportFactory<ActiveEndpointRuntimeConfig, BootstrappedRuntime["logger"]>;
  deliveryRouter?: DeliveryRouter;
  requestControlAction?: (action: RuntimeControlAction) => Promise<void> | void;
}

export function createRuntimeEntries(
  runtimes: BootstrappedRuntime[],
  dependencies: RuntimeRunnerDependencies,
): RuntimeEntry[] {
  const deliveryRouter = dependencies.deliveryRouter ?? createDeliveryRouter();
  const loggedAgentStartup = new Set<string>();
  const endpointTransportById = new Map(runtimes.map((runtime) => [runtime.endpointConfig.id, runtime.endpointConfig.type]));
  const transportContext: TransportContext = {
    deliveryRouter,
    endpointTransportById,
  };

  return runtimes.map((runtime) => {
    const replyChannel = resolveReplyChannel(runtime.endpointConfig, runtimes);
    const handleIncomingMessage = createHandleIncomingMessage({
      agentRegistry: dependencies.agentRegistry,
      conversationStore: runtime.conversationStore,
      engine: runtime.engine,
      defaultAgentId: runtime.endpointConfig.defaultAgentId,
      runtimeInfo: {
        endpointId: runtime.endpointConfig.id,
        configPath: runtime.configPath,
        dataRoot: runtime.endpointConfig.paths.dataRoot,
        logFilePath: runtime.endpointConfig.paths.logFilePath,
        loggingLevel: runtime.loggingLevel,
        activeEndpointIds: runtimes.map((entry) => entry.endpointConfig.id),
        replyChannel,
      },
      logger: runtime.logger,
    });
    const messageProcessor = createMessageProcessor({
      handler: handleIncomingMessage,
      logger: runtime.logger,
      prepareEvent: async (event) => {
        const scopedEvent = withEndpointScopedConversation(event);
        if (scopedEvent.message.command && priorityInboundCommands.has(scopedEvent.message.command)) {
          return scopedEvent;
        }

        if (!scopedEvent.message.command) {
          const command = parseInboundCommand(scopedEvent.message.text, {
            allowedCommands: priorityInboundCommands,
          });
          if (command) {
            return {
              ...scopedEvent,
              message: {
                ...scopedEvent.message,
                ...command,
              },
            };
          }
        }

        const selectedAgentId =
          await runtime.conversationStore.getSelectedAgent?.(scopedEvent.message.conversation) ??
          runtime.endpointConfig.defaultAgentId;
        const detachedSession = getDetachedSessionRequest(scopedEvent.message);
        const resolvedAgentId = resolveDetachedAgentId(detachedSession, dependencies.agentRegistry) ?? selectedAgentId;
        const conversation = detachedSession && scopedEvent.message.conversation.sessionId
          ? await ensureDetachedConversation(runtime, scopedEvent.message, resolvedAgentId, detachedSession)
          : await ensureActiveConversation(runtime, scopedEvent.message, resolvedAgentId);

        return {
          ...scopedEvent,
          message: {
            ...scopedEvent.message,
            conversation: {
              ...scopedEvent.message.conversation,
              sessionId: conversation.state.conversation.sessionId,
              agentId: resolvedAgentId,
            },
          },
        };
      },
      afterDeliveryAction: dependencies.requestControlAction,
    });
    let transport: Transport | undefined;
    let stopped = false;

    return {
      async start(): Promise<void> {
        const defaultAgent = dependencies.agentRegistry.get(runtime.endpointConfig.defaultAgentId);
        await runtime.logger.info("starting endpoint runtime", {
          event: "runtime.endpoint.starting",
          component: "runtime-runner",
          defaultAgentId: defaultAgent?.id ?? "unknown",
          paths: {
            dataRoot: runtime.endpointConfig.paths.dataRoot,
            conversationsDir: runtime.endpointConfig.paths.conversationsDir,
            logsDir: runtime.endpointConfig.paths.logsDir,
            logFilePath: runtime.endpointConfig.paths.logFilePath,
            runtimeDir: runtime.endpointConfig.paths.runtimeDir,
            runtimeStatePath: runtime.endpointConfig.paths.runtimeStatePath,
          },
        });
        for (const agent of dependencies.agentRegistry.list()) {
          if (loggedAgentStartup.has(agent.id)) {
            continue;
          }
          loggedAgentStartup.add(agent.id);

          const agentLogger = runtime.agentLoggers.forAgent(agent.id);
          await agentLogger.info("loaded configured base prompt", {
            event: "agent.config.base_prompt.loaded",
            component: "runtime-runner",
            ...describeBasePrompt(agent.prompt.base),
          });
          await agentLogger.info("loaded configured agent skills", {
            event: "agent.config.skills.loaded",
            component: "runtime-runner",
            configuredSkillNames: (agent.skillCatalog ?? []).map((skill) => skill.name),
          });
          await agentLogger.info("loaded configured instruction files", {
            event: "agent.config.instructions.loaded",
            component: "runtime-runner",
            configuredInstructionFiles: getConfiguredFiles(agent.prompt.instructions),
          });
          await agentLogger.info("loaded configured reference files", {
            event: "agent.config.references.loaded",
            component: "runtime-runner",
            configuredReferenceFiles: getConfiguredFiles(agent.prompt.references),
          });
          for (const issue of agent.skillIssues ?? []) {
            await agentLogger.info(issue, {
              event: "agent.config.skill_issue",
              component: "runtime-runner",
            });
          }
        }
        await runtime.logger.debug("starting transport for endpoint", {
          event: "transport.endpoint.starting",
          component: "runtime-runner",
        });

        if (stopped) {
          return;
        }

        transport = dependencies.createTransport(runtime.endpointConfig, runtime.logger, transportContext);
        if (stopped) {
          await transport.stop?.();
          return;
        }
        let transportStartError: unknown;
        const transportStart = transport.start(messageProcessor).catch((error: unknown) => {
          transportStartError = error;
        });
        await recoverInterruptedRuns(runtime, {
          agentRegistry: dependencies.agentRegistry,
          deliveryRouter,
          replyChannel,
        });
        await transportStart;
        if (transportStartError) {
          throw transportStartError;
        }
      },
      async stop(): Promise<void> {
        if (stopped) {
          return;
        }

        stopped = true;
        try {
          await transport?.stop?.();
        } finally {
          await runtime.engine.close?.();
        }
      },
    };
  });
}

async function ensureActiveConversation(
  runtime: BootstrappedRuntime,
  message: IncomingMessage,
  selectedAgentId: string,
): Promise<ConversationContext> {
  const ensureActive =
    runtime.conversationStore.ensureActiveForAgent ?? runtime.conversationStore.ensureActive;
  return await ensureActive(
    message.conversation,
    {
      agentId: selectedAgentId,
      now: message.receivedAt,
    },
  );
}

async function ensureDetachedConversation(
  runtime: BootstrappedRuntime,
  message: IncomingMessage,
  selectedAgentId: string,
  detachedSession: DetachedSessionRequest,
): Promise<ConversationContext> {
  if (!runtime.conversationStore.ensureDetachedForAgent) {
    return await ensureActiveConversation(runtime, message, selectedAgentId);
  }

  return await runtime.conversationStore.ensureDetachedForAgent(message.conversation, {
    agentId: selectedAgentId,
    now: message.receivedAt,
    title: detachedSession.title,
    kind: detachedSession.kind,
    metadata: detachedSession.metadata,
  });
}

interface DetachedSessionRequest {
  mode: "detached";
  id: string;
  agentId?: string;
  kind?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

function getDetachedSessionRequest(message: IncomingMessage): DetachedSessionRequest | undefined {
  const session = message.source?.plugin?.metadata?.session;
  if (typeof session !== "object" || session === null) {
    return undefined;
  }
  const candidate = session as Record<string, unknown>;
  if (candidate.mode !== "detached" || typeof candidate.id !== "string" || candidate.id.length === 0) {
    return undefined;
  }
  return {
    mode: "detached",
    id: candidate.id,
    ...(typeof candidate.agentId === "string" ? { agentId: candidate.agentId } : {}),
    ...(typeof candidate.kind === "string" ? { kind: candidate.kind } : {}),
    ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
    ...(isRecord(candidate.metadata) ? { metadata: candidate.metadata } : {}),
  };
}

function resolveDetachedAgentId(
  detachedSession: DetachedSessionRequest | undefined,
  agentRegistry: ReturnType<typeof createAgentRegistry>,
): string | undefined {
  if (!detachedSession?.agentId) {
    return undefined;
  }
  return agentRegistry.get(detachedSession.agentId) ? detachedSession.agentId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function recoverInterruptedRuns(
  runtime: BootstrappedRuntime,
  dependencies: {
    agentRegistry: ReturnType<typeof createAgentRegistry>;
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

function getConfiguredFiles(sources: Array<{ file?: string }> | undefined): string[] {
  return (sources ?? [])
    .map((source) => source.file)
    .filter((file): file is string => typeof file === "string");
}

function describeBasePrompt(source: { builtIn?: string; file?: string; text?: string }): {
  basePromptSource: "built-in" | "file" | "text" | "unknown";
  basePromptFile?: string;
  basePromptBuiltIn?: string;
} {
  if (source.file) {
    return {
      basePromptSource: "file",
      basePromptFile: source.file,
    };
  }

  if (source.builtIn) {
    return {
      basePromptSource: "built-in",
      basePromptBuiltIn: source.builtIn,
    };
  }

  if (source.text !== undefined) {
    return {
      basePromptSource: "text",
    };
  }

  return {
    basePromptSource: "unknown",
  };
}

function withEndpointScopedConversation<TEvent extends { message: { endpointId: string; conversation: ChatRef } }>(
  event: TEvent,
): TEvent {
  return {
    ...event,
    message: {
      ...event.message,
      conversation: {
        ...event.message.conversation,
        endpointId: event.message.endpointId,
      },
    },
  };
}

function resolveReplyChannel(
  endpoint: ActiveEndpointRuntimeConfig,
  activeEndpoints: BootstrappedRuntime[],
): ReplyChannelContext {
  if (endpoint.type !== "file") {
    return {
      kind: endpoint.type,
      delivery: "endpoint",
      endpointId: endpoint.id,
    };
  }

  const response = endpoint.response;
  switch (response.type) {
    case "none":
      return {
        kind: "none",
        delivery: "none",
      };
    case "outbox":
      return {
        kind: response.replyChannel.kind,
        delivery: "outbox",
      };
    case "endpoint": {
      const targetEndpoint = activeEndpoints.find(
        (runtime) => runtime.endpointConfig.id === response.endpointId,
      )?.endpointConfig;

      return {
        kind: targetEndpoint?.type ?? response.endpointId,
        delivery: "endpoint",
        endpointId: response.endpointId,
      };
    }
  }
}

export async function runRuntimeEntries(entries: RuntimeEntry[]): Promise<void> {
  const startPromises = entries.map(async (entry) => entry.start());

  try {
    await Promise.all(startPromises);
  } catch (error) {
    await stopRuntimeEntries(entries);
    await Promise.allSettled(startPromises);
    throw error;
  }
}

export async function stopRuntimeEntries(entries: RuntimeEntry[]): Promise<void> {
  await Promise.all(
    [...entries].reverse().map(async (entry) => {
      await entry.stop();
    }),
  );
}
