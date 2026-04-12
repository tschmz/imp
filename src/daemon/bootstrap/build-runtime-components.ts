import type { AgentDefinition } from "../../domain/agent.js";
import { createFileLogger } from "../../logging/file-logger.js";
import type { LogLevel, Logger } from "../../logging/types.js";
import {
  createBuiltInToolRegistry,
  type WorkingDirectoryState,
  createPiAgentEngine,
} from "../../runtime/create-pi-agent-engine.js";
import { createOAuthApiKeyResolver } from "../../runtime/create-oauth-api-key-resolver.js";
import type { AgentEngine } from "../../runtime/types.js";
import { createFsConversationStore } from "../../storage/fs-store.js";
import type { ConversationStore } from "../../storage/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { ActiveEndpointRuntimeConfig, DaemonConfig, RuntimePaths } from "../types.js";

export interface RuntimeComponents {
  loggingLevel: LogLevel;
  logger: Logger;
  conversationStore: ConversationStore;
  engine: AgentEngine;
}

export interface BuildRuntimeComponentsDependencies {
  engine?: AgentEngine;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (
    workingDirectory: string | WorkingDirectoryState,
    agent?: AgentDefinition,
  ) => ToolRegistry;
  createLogger?: (path: string, level: DaemonConfig["logging"]["level"]) => Logger;
  createConversationStore?: (paths: RuntimePaths) => ConversationStore;
}

export function buildRuntimeComponents(
  config: DaemonConfig,
  endpointConfig: ActiveEndpointRuntimeConfig,
  dependencies: BuildRuntimeComponentsDependencies = {},
): RuntimeComponents {
  const createLogger = dependencies.createLogger ?? createFileLogger;
  const createConversationStore =
    dependencies.createConversationStore ?? createFsConversationStore;
  const createBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;

  const logger = createLogger(endpointConfig.paths.logFilePath, config.logging.level);
  const conversationStore = createConversationStore(endpointConfig.paths);

  const getApiKey = async (provider: string, agent: AgentDefinition) =>
    createOAuthApiKeyResolver(agent.authFile, logger)(provider);
  const engine =
    dependencies.engine ??
    createPiAgentEngine({
      logger,
      getApiKey,
      ...(dependencies.toolRegistry ? { toolRegistry: dependencies.toolRegistry } : {}),
      createBuiltInToolRegistry: createBuiltInRegistry,
    });
  return {
    loggingLevel: config.logging.level,
    logger,
    conversationStore,
    engine,
  };
}
