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
import type { Daemon, DaemonConfig, RuntimePaths } from "./types.js";

interface DaemonDependencies {
  logger?: Logger;
  agentRegistry?: ReturnType<typeof createAgentRegistry>;
  conversationStore?: ConversationStore;
  engine?: AgentEngine;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (workingDirectory: string) => ToolRegistry;
  createTransport?: (config: DaemonConfig["activeBot"], logger: Logger) => Transport;
}

export function createDaemon(
  config: DaemonConfig,
  dependencies: DaemonDependencies = {},
): Daemon {
  const agentRegistry =
    dependencies.agentRegistry ?? createAgentRegistry(buildAgents(config.agents));
  const conversationStore = dependencies.conversationStore ?? createFsConversationStore(config.paths);
  const createBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const logger = dependencies.logger ?? createFileLogger(config.paths.logFilePath);
  const engine =
    dependencies.engine ??
    createPiAgentEngine({
      logger,
      ...(dependencies.toolRegistry ? { toolRegistry: dependencies.toolRegistry } : {}),
      createBuiltInToolRegistry: createBuiltInRegistry,
    });
  const createTransport =
    dependencies.createTransport ??
    ((botConfig, runtimeLogger) => createTelegramTransport(botConfig, undefined, runtimeLogger));

  return {
    async start() {
      validateAgentRegistry(agentRegistry, dependencies.toolRegistry, createBuiltInRegistry);
      const handleIncomingMessage = createHandleIncomingMessage({
        agentRegistry,
        conversationStore,
        engine,
        defaultAgentId: config.defaultAgentId,
      });

      await ensureRuntimePaths(config.paths);
      await ensureLogFile(config.paths.logFilePath);
      const runtimeStatePath = config.paths.runtimeStatePath;
      await assertNoRunningInstance(runtimeStatePath);
      await writeRuntimeState(runtimeStatePath, {
        pid: process.pid,
        botId: config.activeBot.id,
        startedAt: new Date().toISOString(),
        configPath: config.configPath,
        logFilePath: config.paths.logFilePath,
      });
      const cleanup = registerRuntimeCleanup({ runtimeStatePath });

      try {
        const defaultAgent = agentRegistry.get(config.defaultAgentId);
        await logger.info(`starting daemon with default agent "${defaultAgent?.id ?? "unknown"}"`);
        await logger.info(`data root: ${config.paths.dataRoot}`);
        await logger.info(`bot root: ${config.paths.botRoot}`);
        await logger.info(`conversations dir: ${config.paths.conversationsDir}`);
        await logger.info(`logs dir: ${config.paths.logsDir}`);
        await logger.info(`log file: ${config.paths.logFilePath}`);
        await logger.info(`runtime dir: ${config.paths.runtimeDir}`);
        await logger.info(`runtime file: ${runtimeStatePath}`);

        await logger.info(`active bot: ${config.activeBot.id}`);

        const transport = createTransport(config.activeBot, logger);
        await transport.start(handleIncomingMessage);
      } finally {
        cleanup.dispose();
        await cleanup.run();
      }
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

function registerRuntimeCleanup(paths: { runtimeStatePath: string }): {
  dispose(): void;
  run(): Promise<void>;
} {
  let cleanedUp = false;

  const run = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await cleanupRuntimeState(paths.runtimeStatePath);
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
