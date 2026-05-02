import { createHandleIncomingMessage } from "../application/handle-incoming-message.js";
import { createMessageProcessor } from "../application/message-processor.js";
import type { AgentRegistry } from "../agents/registry.js";
import { createDeliveryRouter, type DeliveryRouter } from "../transports/delivery-router.js";
import type { ReplyChannelContext } from "../runtime/context.js";
import type { Transport, TransportContext, TransportFactory } from "../transports/types.js";
import { createRuntimeMessagePreparer } from "./runtime-message-preparation.js";
import { recoverInterruptedRuns } from "./runtime-recovery.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import { logRuntimeStartup } from "./runtime-startup-logging.js";
import type { RuntimeControlAction } from "./runtime-shutdown.js";
import type { ActiveEndpointRuntimeConfig } from "./types.js";
import { createCronSchedulerEntry } from "./cron-scheduler.js";

export interface RuntimeEntry {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface RuntimeRunnerDependencies {
  agentRegistry: AgentRegistry;
  createTransport: TransportFactory<ActiveEndpointRuntimeConfig, BootstrappedRuntime["logger"]>;
  deliveryRouter?: DeliveryRouter;
  requestControlAction?: (action: RuntimeControlAction) => Promise<void> | void;
  enableCronScheduler?: boolean;
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

  const endpointEntries = runtimes.map((runtime) => {
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
      ...(runtime.resolveAgentRuntimeSurface
        ? { resolveAgentRuntimeSurface: runtime.resolveAgentRuntimeSurface }
        : {}),
      logger: runtime.logger,
    });
    const messageProcessor = createMessageProcessor({
      handler: handleIncomingMessage,
      logger: runtime.logger,
      prepareEvent: createRuntimeMessagePreparer(runtime, dependencies.agentRegistry),
      afterDeliveryAction: dependencies.requestControlAction,
    });
    let transport: Transport | undefined;
    let stopped = false;

    return {
      async start(): Promise<void> {
        await logRuntimeStartup(runtime, dependencies.agentRegistry, loggedAgentStartup);

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
          try {
            try {
              await runtime.engine.close?.();
            } finally {
              await runtime.closeAgentRuntimeSurface?.();
            }
          } finally {
            await runtime.logger.close?.();
          }
        }
      },
    };
  });

  if (!dependencies.enableCronScheduler) {
    return endpointEntries;
  }

  return [
    ...endpointEntries,
    createCronSchedulerEntry({
      agentRegistry: dependencies.agentRegistry,
      runtimes,
      deliveryRouter,
      logger: runtimes[0]?.logger,
    }),
  ];
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
