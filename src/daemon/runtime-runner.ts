import { parseInboundCommand } from "../application/commands/parse-inbound-command.js";
import { priorityInboundCommands } from "../application/commands/priority-inbound-commands.js";
import { createHandleIncomingMessage } from "../application/handle-incoming-message.js";
import { createMessageProcessor } from "../application/message-processor.js";
import { createAgentRegistry } from "../agents/registry.js";
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
  const transportContext: TransportContext = {
    deliveryRouter,
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
        const ensureActive =
          runtime.conversationStore.ensureActiveForAgent ?? runtime.conversationStore.ensureActive;
        const conversation = await ensureActive(
          scopedEvent.message.conversation,
          {
            agentId: selectedAgentId,
            now: scopedEvent.message.receivedAt,
          },
        );

        return {
          ...scopedEvent,
          message: {
            ...scopedEvent.message,
            conversation: {
              ...scopedEvent.message.conversation,
              sessionId: conversation.state.conversation.sessionId,
              agentId: selectedAgentId,
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
        await runtime.logger.info(
          `starting daemon with default agent "${defaultAgent?.id ?? "unknown"}"`,
        );
        await runtime.logger.info(`data root: ${runtime.endpointConfig.paths.dataRoot}`);
        await runtime.logger.info(`conversations dir: ${runtime.endpointConfig.paths.conversationsDir}`);
        await runtime.logger.info(`logs dir: ${runtime.endpointConfig.paths.logsDir}`);
        await runtime.logger.info(`log file: ${runtime.endpointConfig.paths.logFilePath}`);
        await runtime.logger.info(`runtime dir: ${runtime.endpointConfig.paths.runtimeDir}`);
        await runtime.logger.info(`runtime file: ${runtime.endpointConfig.paths.runtimeStatePath}`);
        await runtime.logger.info(`active endpoint: ${runtime.endpointConfig.id}`);
        for (const agent of dependencies.agentRegistry.list()) {
          await runtime.logger.info("discovered agent skills", {
            endpointId: runtime.endpointConfig.id,
            agentId: agent.id,
            skillCount: agent.skillCatalog?.length ?? 0,
            skillNames: (agent.skillCatalog ?? []).map((skill) => skill.name),
          });
          for (const issue of agent.skillIssues ?? []) {
            await runtime.logger.info(issue, { endpointId: runtime.endpointConfig.id, agentId: agent.id });
          }
        }
        await runtime.logger.debug("starting transport for endpoint", {
          endpointId: runtime.endpointConfig.id,
        });

        if (stopped) {
          return;
        }

        transport = dependencies.createTransport(runtime.endpointConfig, runtime.logger, transportContext);
        if (stopped) {
          await transport.stop?.();
          return;
        }
        await transport.start(messageProcessor);
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
  if (endpoint.type !== "plugin") {
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
