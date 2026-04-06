import { mkdir, writeFile } from "node:fs/promises";
import type { AgentDefinition } from "../domain/agent.js";
import { createFileLogger } from "../logging/file-logger.js";
import type { Logger } from "../logging/types.js";
import {
  createBuiltInToolRegistry,
  type WorkingDirectoryState,
  createPiAgentEngine,
} from "../runtime/create-pi-agent-engine.js";
import { createOAuthApiKeyResolver } from "../runtime/create-oauth-api-key-resolver.js";
import type { AgentEngine } from "../runtime/types.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import type { ConversationStore } from "../storage/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import {
  assertNoRunningInstance,
  cleanupRuntimeState,
  writeRuntimeState,
} from "./runtime-state.js";
import type { ActiveBotRuntimeConfig, DaemonConfig, RuntimePaths } from "./types.js";

export interface BootstrappedRuntime {
  botConfig: ActiveBotRuntimeConfig;
  logger: Logger;
  conversationStore: ConversationStore;
  engine: AgentEngine;
}

export interface RuntimeBootstrapDependencies {
  engine?: AgentEngine;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (
    workingDirectory: string | WorkingDirectoryState,
    agent?: AgentDefinition,
  ) => ToolRegistry;
  createLogger?: (path: string, level: DaemonConfig["logging"]["level"]) => Logger;
  createConversationStore?: (paths: RuntimePaths) => ConversationStore;
}

export async function bootstrapRuntime(
  config: DaemonConfig,
  botConfig: ActiveBotRuntimeConfig,
  dependencies: RuntimeBootstrapDependencies = {},
): Promise<BootstrappedRuntime> {
  const createLogger = dependencies.createLogger ?? createFileLogger;
  const createConversationStore =
    dependencies.createConversationStore ?? createFsConversationStore;
  const createBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const logger = createLogger(botConfig.paths.logFilePath, config.logging.level);
  const conversationStore = createConversationStore(botConfig.paths);

  let runtimeStateWritten = false;

  try {
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
    runtimeStateWritten = true;
    await logger.debug("initialized bot runtime state", {
      botId: botConfig.id,
    });

    const engine =
      dependencies.engine ??
      createPiAgentEngine({
        logger,
        getApiKey: (provider, agent) =>
          createOAuthApiKeyResolver(agent.authFile, logger)(provider),
        ...(dependencies.toolRegistry ? { toolRegistry: dependencies.toolRegistry } : {}),
        createBuiltInToolRegistry: createBuiltInRegistry,
      });

    return {
      botConfig,
      logger,
      conversationStore,
      engine,
    };
  } catch (error) {
    if (runtimeStateWritten) {
      await cleanupRuntimeState(botConfig.paths.runtimeStatePath);
    }
    throw error;
  }
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
