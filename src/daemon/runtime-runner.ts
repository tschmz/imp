import { createHandleIncomingMessage } from "../application/handle-incoming-message.js";
import { createMessageProcessor } from "../application/message-processor.js";
import { createAgentRegistry } from "../agents/registry.js";
import { createTelegramTransport } from "../transports/telegram/telegram-transport.js";
import type { Transport } from "../transports/types.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import type { ActiveBotRuntimeConfig } from "./types.js";

export interface RuntimeEntry {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface RuntimeRunnerDependencies {
  agentRegistry: ReturnType<typeof createAgentRegistry>;
  createTransport?: (config: ActiveBotRuntimeConfig, logger: BootstrappedRuntime["logger"]) => Transport;
}

export function createRuntimeEntries(
  runtimes: BootstrappedRuntime[],
  dependencies: RuntimeRunnerDependencies,
): RuntimeEntry[] {
  const createTransport =
    dependencies.createTransport ??
    ((botConfig, logger) => createTelegramTransport(botConfig, undefined, logger));

  return runtimes.map((runtime) => {
    const handleIncomingMessage = createHandleIncomingMessage({
      agentRegistry: dependencies.agentRegistry,
      conversationStore: runtime.conversationStore,
      engine: runtime.engine,
      defaultAgentId: runtime.botConfig.defaultAgentId,
      logger: runtime.logger,
    });
    const messageProcessor = createMessageProcessor({
      handler: handleIncomingMessage,
      logger: runtime.logger,
    });
    let transport: Transport | undefined;
    let stopped = false;

    return {
      async start(): Promise<void> {
        const defaultAgent = dependencies.agentRegistry.get(runtime.botConfig.defaultAgentId);
        await runtime.logger.info(
          `starting daemon with default agent "${defaultAgent?.id ?? "unknown"}"`,
        );
        await runtime.logger.info(`data root: ${runtime.botConfig.paths.dataRoot}`);
        await runtime.logger.info(`bot root: ${runtime.botConfig.paths.botRoot}`);
        await runtime.logger.info(`conversations dir: ${runtime.botConfig.paths.conversationsDir}`);
        await runtime.logger.info(`logs dir: ${runtime.botConfig.paths.logsDir}`);
        await runtime.logger.info(`log file: ${runtime.botConfig.paths.logFilePath}`);
        await runtime.logger.info(`runtime dir: ${runtime.botConfig.paths.runtimeDir}`);
        await runtime.logger.info(`runtime file: ${runtime.botConfig.paths.runtimeStatePath}`);
        await runtime.logger.info(`active bot: ${runtime.botConfig.id}`);
        await runtime.logger.debug("starting transport for bot", {
          botId: runtime.botConfig.id,
        });

        if (stopped) {
          return;
        }

        transport = createTransport(runtime.botConfig, runtime.logger);
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
        await transport?.stop?.();
      },
    };
  });
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
