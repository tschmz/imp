import type { AgentRegistry } from "../../agents/registry.js";
import type { AgentDefinition } from "../../domain/agent.js";
import { createAgentLoggers, createScopedLogger, type AgentLoggers } from "../../logging/agent-loggers.js";
import { createFileLogger, type FileLoggerOptions } from "../../logging/file-logger.js";
import type { LogLevel, Logger } from "../../logging/types.js";
import { createRoutingLogger } from "../../logging/routing-logger.js";
import {
  createBuiltInToolRegistry,
  type WorkingDirectoryState,
  createPiAgentEngine,
} from "../../runtime/create-pi-agent-engine.js";
import { createOAuthApiKeyResolver } from "../../runtime/create-oauth-api-key-resolver.js";
import type { AgentEngine } from "../../runtime/types.js";
import { createFsConversationStore } from "../../storage/fs-store.js";
import type { ConversationStore } from "../../storage/types.js";
import { createToolRegistry, type ToolRegistry } from "../../tools/registry.js";
import type { ActiveEndpointRuntimeConfig, DaemonConfig, RuntimePaths } from "../types.js";

export interface RuntimeComponents {
  loggingLevel: LogLevel;
  logger: Logger;
  endpointLogger: Logger;
  agentLoggers: AgentLoggers;
  conversationStore: ConversationStore;
  engine: AgentEngine;
}

export interface BuildRuntimeComponentsDependencies {
  agentRegistry?: AgentRegistry;
  engine?: AgentEngine;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (
    workingDirectory: string | WorkingDirectoryState,
    agent?: AgentDefinition,
  ) => ToolRegistry;
  createLogger?: (path: string, level: DaemonConfig["logging"]["level"], options?: FileLoggerOptions) => Logger;
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
  const configuredBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const createBuiltInRegistry = createRuntimeToolRegistryFactory(config, configuredBuiltInRegistry);

  const loggerOptions = { rotationSize: config.logging.rotationSize };
  const endpointLogger = createScopedLogger(createLogger(endpointConfig.paths.logFilePath, config.logging.level, loggerOptions), {
    endpointId: endpointConfig.id,
  });
  const agentLoggers = createAgentLoggers(
    endpointConfig.paths.dataRoot,
    config.logging.level,
    createLogger,
    loggerOptions,
  );
  const logger = createRoutingLogger(endpointLogger, agentLoggers);
  const conversationStore = createConversationStore(endpointConfig.paths);

  const getApiKey = async (provider: string, agent: AgentDefinition) => {
    if (provider === agent.model.provider && agent.model.apiKey) {
      return agent.model.apiKey;
    }

    return createOAuthApiKeyResolver(agent.model.authFile, logger)(provider);
  };
  const engine =
    dependencies.engine ??
    createPiAgentEngine({
      logger,
      getApiKey,
      ...(dependencies.agentRegistry ? { agentRegistry: dependencies.agentRegistry } : {}),
      ...(dependencies.toolRegistry ? { toolRegistry: dependencies.toolRegistry } : {}),
      createBuiltInToolRegistry: createBuiltInRegistry,
    });
  return {
    loggingLevel: config.logging.level,
    logger,
    endpointLogger,
    agentLoggers,
    conversationStore,
    engine,
  };
}

function createRuntimeToolRegistryFactory(
  config: DaemonConfig,
  createBuiltInRegistry: NonNullable<BuildRuntimeComponentsDependencies["createBuiltInToolRegistry"]>,
): NonNullable<BuildRuntimeComponentsDependencies["createBuiltInToolRegistry"]> {
  const pluginTools = config.pluginTools ?? [];
  return (workingDirectory, agent) => {
    const builtInRegistry = createBuiltInRegistry(workingDirectory, agent);
    if (pluginTools.length === 0) {
      return builtInRegistry;
    }

    return createToolRegistry([
      ...builtInRegistry.list(),
      ...pluginTools,
    ]);
  };
}
