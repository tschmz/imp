import type { AgentRegistry } from "../../agents/registry.js";
import type { AgentRuntimeCommandSurfaceResolver } from "../../application/commands/types.js";
import type { AgentDefinition } from "../../domain/agent.js";
import { createAgentLoggers, createScopedLogger, type AgentLoggers } from "../../logging/agent-loggers.js";
import { createFileLogger, type FileLoggerOptions } from "../../logging/file-logger.js";
import type { LogLevel, Logger } from "../../logging/types.js";
import { createRoutingLogger } from "../../logging/routing-logger.js";
import {
  createBuiltInToolRegistry,
  createPiAgentEngine,
} from "../../runtime/create-pi-agent-engine.js";
import { createAgentRuntimeSurfaceResolver } from "../../runtime/agent-runtime-surface.js";
import { createOAuthApiKeyResolver } from "../../runtime/create-oauth-api-key-resolver.js";
import { createMcpToolCache } from "../../runtime/mcp-tool-cache.js";
import { resolveMcpTools } from "../../runtime/mcp-tool-runtime.js";
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
  resolveAgentRuntimeSurface: AgentRuntimeCommandSurfaceResolver;
  closeAgentRuntimeSurface(): Promise<void>;
}

export interface BuildRuntimeComponentsDependencies {
  agentRegistry?: AgentRegistry;
  engine?: AgentEngine;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: typeof createBuiltInToolRegistry;
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
  const mcpToolCache = createMcpToolCache({
    logger,
    resolveMcpTools,
  });
  const resolveRuntimeSurface = createAgentRuntimeSurfaceResolver({
    ...(dependencies.toolRegistry ? { toolRegistry: dependencies.toolRegistry } : {}),
    createBuiltInToolRegistry: createBuiltInRegistry,
    mcpToolCache,
    ...(dependencies.agentRegistry ? { agentRegistry: dependencies.agentRegistry } : {}),
  });

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
      mcpToolCache,
    });
  return {
    loggingLevel: config.logging.level,
    logger,
    endpointLogger,
    agentLoggers,
    conversationStore,
    engine,
    resolveAgentRuntimeSurface: async ({ agent, conversation, message, runtimeInfo }) => resolveRuntimeSurface({
      agent,
      conversation,
      message,
      runtime: {
        configPath: runtimeInfo.configPath,
        dataRoot: runtimeInfo.dataRoot,
        invocation: {
          kind: "direct",
        },
        ingress: {
          endpointId: message.endpointId,
          transportKind: message.conversation.transport,
        },
        output: {
          mode: "reply-channel",
          ...(runtimeInfo.replyChannel ? { replyChannel: runtimeInfo.replyChannel } : {}),
        },
        ...(runtimeInfo.replyChannel ? { replyChannel: runtimeInfo.replyChannel } : {}),
      },
    }),
    closeAgentRuntimeSurface: async () => {
      await mcpToolCache.close();
    },
  };
}

function createRuntimeToolRegistryFactory(
  config: DaemonConfig,
  createBuiltInRegistry: NonNullable<BuildRuntimeComponentsDependencies["createBuiltInToolRegistry"]>,
): NonNullable<BuildRuntimeComponentsDependencies["createBuiltInToolRegistry"]> {
  const pluginTools = config.pluginTools ?? [];
  return (workingDirectory, agent, attachmentCollector, context) => {
    const builtInRegistry = createBuiltInRegistry(workingDirectory, agent, attachmentCollector, context);
    if (pluginTools.length === 0) {
      return builtInRegistry;
    }

    return createToolRegistry([
      ...builtInRegistry.list(),
      ...pluginTools,
    ]);
  };
}
