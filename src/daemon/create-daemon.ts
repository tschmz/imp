import { mkdir, writeFile } from "node:fs/promises";
import { createHandleIncomingMessage } from "../application/handle-incoming-message.js";
import { loadBuiltInAgents } from "../agents/definitions.js";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import { createFileLogger } from "../logging/file-logger.js";
import type { Logger } from "../logging/types.js";
import {
  createBuiltInToolRegistry,
  createPiAgentEngine,
  resolveAgentTools,
  resolveWorkingDirectory,
} from "../runtime/create-pi-agent-engine.js";
import type { AgentEngine } from "../runtime/types.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import type { ConversationStore } from "../storage/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createTelegramTransport } from "../transports/telegram/telegram-transport.js";
import type { Transport } from "../transports/types.js";
import {
  assertNoRunningInstance,
  cleanupRuntimeState,
  writeRuntimeState,
} from "./runtime-state.js";
import type { ActiveBotRuntimeConfig, Daemon, DaemonConfig, RuntimePaths } from "./types.js";

interface DaemonDependencies {
  agentRegistry?: ReturnType<typeof createAgentRegistry>;
  engine?: AgentEngine;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (workingDirectory: string) => ToolRegistry;
  createLogger?: (path: string) => Logger;
  createConversationStore?: (paths: RuntimePaths) => ConversationStore;
  createTransport?: (config: ActiveBotRuntimeConfig, logger: Logger) => Transport;
}

export function createDaemon(
  config: DaemonConfig,
  dependencies: DaemonDependencies = {},
): Daemon {
  const agentRegistry =
    dependencies.agentRegistry ?? createAgentRegistry(buildAgents(config.agents));
  const createBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const createLogger = dependencies.createLogger ?? createFileLogger;
  const createConversationStore =
    dependencies.createConversationStore ?? createFsConversationStore;
  const createTransport =
    dependencies.createTransport ??
    ((botConfig, runtimeLogger) => createTelegramTransport(botConfig, undefined, runtimeLogger));

  return {
    async start() {
      validateAgentRegistry(agentRegistry, dependencies.toolRegistry, createBuiltInRegistry);
      const runtimeEntries = await Promise.all(
        config.activeBots.map(async (botConfig) => {
          const logger = createLogger(botConfig.paths.logFilePath);
          const conversationStore = createConversationStore(botConfig.paths);

          await ensureRuntimePaths(botConfig.paths);
          await ensureLogFile(botConfig.paths.logFilePath);
          await assertNoRunningInstance(botConfig.paths.runtimeStatePath);
          await writeRuntimeState(botConfig.paths.runtimeStatePath, {
            pid: process.pid,
            botId: botConfig.id,
            startedAt: new Date().toISOString(),
            configPath: config.configPath,
            logFilePath: botConfig.paths.logFilePath,
          });

          return {
            botConfig,
            logger,
            conversationStore,
          };
        }),
      );
      const logger = createBroadcastLogger(runtimeEntries.map((entry) => entry.logger));
      const engine =
        dependencies.engine ??
        createPiAgentEngine({
          logger,
          ...(dependencies.toolRegistry ? { toolRegistry: dependencies.toolRegistry } : {}),
          createBuiltInToolRegistry: createBuiltInRegistry,
        });
      const activeRuntimeEntries = runtimeEntries.map((entry) => ({
        ...entry,
        handleIncomingMessage: createHandleIncomingMessage({
          agentRegistry,
          conversationStore: entry.conversationStore,
          engine,
          defaultAgentId: entry.botConfig.defaultAgentId,
        }),
      }));
      const cleanup = registerRuntimeCleanup(
        activeRuntimeEntries.map(({ botConfig }) => ({
          runtimeStatePath: botConfig.paths.runtimeStatePath,
        })),
      );

      try {
        await Promise.all(
          activeRuntimeEntries.map(async ({ botConfig, logger, handleIncomingMessage }) => {
            const defaultAgent = agentRegistry.get(botConfig.defaultAgentId);
            await logger.info(
              `starting daemon with default agent "${defaultAgent?.id ?? "unknown"}"`,
            );
            await logger.info(`data root: ${botConfig.paths.dataRoot}`);
            await logger.info(`bot root: ${botConfig.paths.botRoot}`);
            await logger.info(`conversations dir: ${botConfig.paths.conversationsDir}`);
            await logger.info(`logs dir: ${botConfig.paths.logsDir}`);
            await logger.info(`log file: ${botConfig.paths.logFilePath}`);
            await logger.info(`runtime dir: ${botConfig.paths.runtimeDir}`);
            await logger.info(`runtime file: ${botConfig.paths.runtimeStatePath}`);
            await logger.info(`active bot: ${botConfig.id}`);

            const transport = createTransport(botConfig, logger);
            await transport.start(handleIncomingMessage);
          }),
        );
      } finally {
        cleanup.dispose();
        await cleanup.run();
      }
    },
  };
}

function createBroadcastLogger(loggers: Logger[]): Logger {
  return {
    async info(message, fields) {
      await Promise.all(loggers.map(async (logger) => logger.info(message, fields)));
    },
    async error(message, fields, error) {
      await Promise.all(loggers.map(async (logger) => logger.error(message, fields, error)));
    },
  };
}

function validateAgentRegistry(
  agentRegistry: ReturnType<typeof createAgentRegistry>,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string) => ToolRegistry,
): void {
  for (const agent of agentRegistry.list()) {
    const registry = toolRegistry ?? createBuiltInRegistry(resolveWorkingDirectory(agent));
    resolveAgentTools(agent, registry);
  }
}

function buildAgents(configuredAgents: DaemonConfig["agents"]): AgentDefinition[] {
  const builtIns = loadBuiltInAgents();
  const builtInsById = new Map(builtIns.map((agent) => [agent.id, agent]));

  return configuredAgents.map((configuredAgent) => {
    const builtIn = builtInsById.get(configuredAgent.id);

    if (!builtIn) {
      if (!configuredAgent.systemPrompt) {
        throw new Error(
          `Configured agent "${configuredAgent.id}" must define systemPrompt.`,
        );
      }

      if (!configuredAgent.model) {
        throw new Error(`Configured agent "${configuredAgent.id}" must define model.`);
      }
    }

    return {
      id: configuredAgent.id,
      name: configuredAgent.name ?? builtIn?.name ?? configuredAgent.id,
      systemPrompt: configuredAgent.systemPrompt ?? builtIn?.systemPrompt ?? "",
      model: configuredAgent.model ?? builtIn?.model ?? { provider: "", modelId: "" },
      inference: configuredAgent.inference ?? builtIn?.inference,
      context: configuredAgent.context ?? builtIn?.context,
      tools: configuredAgent.tools ?? builtIn?.tools ?? [],
      extensions: builtIn?.extensions ?? [],
    };
  });
}
async function ensureRuntimePaths(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.botRoot, { recursive: true });
  await mkdir(paths.conversationsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runtimeDir, { recursive: true });
}

async function ensureLogFile(path: string): Promise<void> {
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}

function registerRuntimeCleanup(paths: Array<{ runtimeStatePath: string }>): {
  dispose(): void;
  run(): Promise<void>;
} {
  let cleanedUp = false;

  const run = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await Promise.all(paths.map(async (path) => cleanupRuntimeState(path.runtimeStatePath)));
  };

  const handleSigint = () => {
    void run().finally(() => {
      process.exit(130);
    });
  };

  const handleSigterm = () => {
    void run().finally(() => {
      process.exit(143);
    });
  };

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  return {
    dispose() {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
    },
    run,
  };
}
