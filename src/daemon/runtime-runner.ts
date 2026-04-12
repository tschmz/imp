import { parseInboundCommand } from "../application/commands/parse-inbound-command.js";
import { priorityInboundCommands } from "../application/commands/priority-inbound-commands.js";
import { createHandleIncomingMessage } from "../application/handle-incoming-message.js";
import { createMessageProcessor } from "../application/message-processor.js";
import { createAgentRegistry } from "../agents/registry.js";
import type { Transport, TransportFactory } from "../transports/types.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import type { RuntimeControlAction } from "./runtime-shutdown.js";
import type { ActiveBotRuntimeConfig } from "./types.js";

export interface RuntimeEntry {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface RuntimeRunnerDependencies {
  agentRegistry: ReturnType<typeof createAgentRegistry>;
  createTransport: TransportFactory<ActiveBotRuntimeConfig, BootstrappedRuntime["logger"]>;
  requestControlAction?: (action: RuntimeControlAction) => void;
}

export function createRuntimeEntries(
  runtimes: BootstrappedRuntime[],
  dependencies: RuntimeRunnerDependencies,
): RuntimeEntry[] {
  return runtimes.map((runtime) => {
    const handleIncomingMessage = createHandleIncomingMessage({
      agentRegistry: dependencies.agentRegistry,
      conversationStore: runtime.conversationStore,
      engine: runtime.engine,
      defaultAgentId: runtime.botConfig.defaultAgentId,
      runtimeInfo: {
        botId: runtime.botConfig.id,
        configPath: runtime.configPath,
        dataRoot: runtime.botConfig.paths.dataRoot,
        logFilePath: runtime.botConfig.paths.logFilePath,
        loggingLevel: runtime.loggingLevel,
        activeBotIds: runtimes.map((entry) => entry.botConfig.id),
      },
      logger: runtime.logger,
    });
    const messageProcessor = createMessageProcessor({
      handler: handleIncomingMessage,
      logger: runtime.logger,
      prepareEvent: async (event) => {
        if (event.message.command && priorityInboundCommands.has(event.message.command)) {
          return event;
        }

        if (!event.message.command) {
          const command = parseInboundCommand(event.message.text, {
            allowedCommands: priorityInboundCommands,
          });
          if (command) {
            return {
              ...event,
              message: {
                ...event.message,
                ...command,
              },
            };
          }
        }

        const conversation = await runtime.conversationStore.ensureActive(
          event.message.conversation,
          {
            agentId: runtime.botConfig.defaultAgentId,
            now: event.message.receivedAt,
          },
        );

        return {
          ...event,
          message: {
            ...event.message,
            conversation: conversation.state.conversation,
          },
        };
      },
      afterDeliveryAction: dependencies.requestControlAction,
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
        for (const agent of dependencies.agentRegistry.list()) {
          await runtime.logger.info("discovered agent skills", {
            botId: runtime.botConfig.id,
            agentId: agent.id,
            skillCount: agent.skillCatalog?.length ?? 0,
            skillNames: (agent.skillCatalog ?? []).map((skill) => skill.name),
          });
          for (const issue of agent.skillIssues ?? []) {
            await runtime.logger.info(issue, { botId: runtime.botConfig.id, agentId: agent.id });
          }
        }
        await runtime.logger.debug("starting transport for bot", {
          botId: runtime.botConfig.id,
        });

        if (stopped) {
          return;
        }

        transport = dependencies.createTransport(runtime.botConfig, runtime.logger);
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
