import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import { ConfigurationError } from "../domain/errors.js";
import type { Logger } from "../logging/types.js";
import { prepareAgentLogFiles } from "../logging/agent-loggers.js";
import { prepareAgentHomeDirectories } from "./bootstrap/prepare-runtime-filesystem.js";
import {
  createBuiltInToolRegistry,
  type WorkingDirectoryState,
  resolveAgentTools,
  resolveWorkingDirectory,
} from "../runtime/create-pi-agent-engine.js";
import { validateResolvedToolNames } from "../runtime/validate-resolved-tool-names.js";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.js";
import type { TransportFactory } from "../transports/types.js";
import {
  bootstrapRuntime,
  type BootstrappedRuntime,
  type RuntimeBootstrapDependencies,
} from "./runtime-bootstrap.js";
import {
  createRuntimeEntries,
  runRuntimeEntries,
} from "./runtime-runner.js";
import {
  createRuntimeShutdown,
  type RuntimeControlAction,
  type RuntimeLifecycleProcess,
} from "./runtime-shutdown.js";
import { cleanupRuntimeState } from "./runtime-state.js";
import { createDeferredActionController } from "./deferred-action-controller.js";
import type { ActiveEndpointRuntimeConfig, Daemon, DaemonConfig } from "./types.js";

interface DaemonDependencies extends RuntimeBootstrapDependencies {
  agentRegistry?: ReturnType<typeof createAgentRegistry>;
  createTransport: TransportFactory<ActiveEndpointRuntimeConfig, Logger>;
  runtimeProcess?: RuntimeLifecycleProcess;
}

export function createDaemon(
  config: DaemonConfig,
  dependencies: DaemonDependencies,
): Daemon {
  const agentRegistry =
    dependencies.agentRegistry ?? createAgentRegistry(buildAgents(config.agents));
  const createBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;

  return {
    async start() {
      const createRuntimeToolRegistry = createRuntimeToolRegistryFactory(createBuiltInRegistry, config.pluginTools ?? []);
      validateAgentRegistry(agentRegistry, dependencies.toolRegistry, createRuntimeToolRegistry);
      await prepareAgentHomeDirectories(agentRegistry.list());
      await prepareAgentLogFiles(
        config.activeEndpoints.map((endpoint) => endpoint.paths.dataRoot),
        agentRegistry.list().map((agent) => agent.id),
      );
      const runtimes: BootstrappedRuntime[] = [];

      try {
        for (const endpointConfig of config.activeEndpoints) {
          runtimes.push(await bootstrapRuntime(config, endpointConfig, {
            ...dependencies,
            createBuiltInToolRegistry: createRuntimeToolRegistry,
            agentRegistry,
          }));
        }
      } catch (error) {
        await Promise.all(
          runtimes.map(async (runtime) => {
            try {
              await runtime.engine.close?.();
            } finally {
              await cleanupRuntimeState(runtime.endpointConfig.paths.runtimeStatePath);
            }
          }),
        );
        throw error;
      }
      const runtimeControl = createDeferredActionController<RuntimeControlAction>();
      const runtimeEntries = createRuntimeEntries(runtimes, {
        agentRegistry,
        createTransport: dependencies.createTransport,
        requestControlAction: (action) => {
          runtimeControl.request(action);
        },
      });
      const shutdown = createRuntimeShutdown(
        runtimeEntries,
        runtimes.map((runtime) => runtime.endpointConfig.paths.runtimeStatePath),
        dependencies.runtimeProcess,
      );
      runtimeControl.setHandler((action) => {
        shutdown.requestControlAction(action);
      });
      const registeredSignals = shutdown.registerSignalHandlers();

      try {
        await runRuntimeEntries(runtimeEntries);
      } finally {
        registeredSignals.dispose();
        await shutdown.shutdown();
      }
    },
  };
}


function createRuntimeToolRegistryFactory(
  createBuiltInRegistry: (workingDirectory: string | WorkingDirectoryState, agent?: AgentDefinition) => ToolRegistry,
  pluginTools: NonNullable<DaemonConfig["pluginTools"]>,
): (workingDirectory: string | WorkingDirectoryState, agent?: AgentDefinition) => ToolRegistry {
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

export function validateAgentRegistry(
  agentRegistry: ReturnType<typeof createAgentRegistry>,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string | WorkingDirectoryState, agent?: AgentDefinition) => ToolRegistry,
): void {
  for (const agent of agentRegistry.list()) {
    validateAgentPrompt(agent);
    validateAgentDelegations(agent, agentRegistry);
    const registry = toolRegistry ?? createBuiltInRegistry(resolveWorkingDirectory(agent), agent);
    const resolvedBuiltInTools = resolveAgentTools(agent, registry).map((tool) => tool.name);
    validateResolvedToolNames(agent.id, {
      builtIn: resolvedBuiltInTools,
      delegation: (agent.delegations ?? []).map((delegation) => delegation.toolName),
      mcp: [],
    });
  }
}

export function buildAgents(configuredAgents: DaemonConfig["agents"]): AgentDefinition[] {
  return configuredAgents.map((configuredAgent) => {
    validatePromptBase(configuredAgent.id, configuredAgent.prompt.base);

    if (!configuredAgent.model) {
      throw new ConfigurationError(`Configured agent "${configuredAgent.id}" must define model.`);
    }

    return {
      id: configuredAgent.id,
      name: configuredAgent.name ?? configuredAgent.id,
      prompt: configuredAgent.prompt,
      model: configuredAgent.model,
      ...(configuredAgent.home ? { home: configuredAgent.home } : {}),
      ...(configuredAgent.workspace ? { workspace: configuredAgent.workspace } : {}),
      ...(configuredAgent.skills ? { skills: configuredAgent.skills } : {}),
      ...(configuredAgent.skillCatalog ? { skillCatalog: configuredAgent.skillCatalog } : {}),
      ...(configuredAgent.skillIssues ? { skillIssues: configuredAgent.skillIssues } : {}),
      ...(configuredAgent.delegations ? { delegations: configuredAgent.delegations } : {}),
      ...(configuredAgent.mcp ? { mcp: configuredAgent.mcp } : {}),
      ...(configuredAgent.phone ? { phone: configuredAgent.phone } : {}),
      tools: configuredAgent.tools ?? [],
      extensions: [],
    };
  });
}

function validateAgentPrompt(agent: AgentDefinition): void {
  validatePromptBase(agent.id, agent.prompt.base);
}

function validateAgentDelegations(
  agent: AgentDefinition,
  agentRegistry: ReturnType<typeof createAgentRegistry>,
): void {
  for (const delegation of agent.delegations ?? []) {
    if (delegation.agentId === agent.id) {
      throw new ConfigurationError(`Agent "${agent.id}" cannot delegate to itself.`);
    }

    if (!agentRegistry.get(delegation.agentId)) {
      throw new ConfigurationError(
        `Unknown delegated agent id "${delegation.agentId}" for agent "${agent.id}".`,
      );
    }
  }
}

function validatePromptBase(
  agentId: string,
  basePrompt: {
    text?: string;
    file?: string;
    builtIn?: string;
  },
): void {
  const hasText = typeof basePrompt.text === "string" && basePrompt.text.trim().length > 0;
  const hasFile = typeof basePrompt.file === "string" && basePrompt.file.trim().length > 0;
  const hasBuiltIn = basePrompt.builtIn === "default";

  if (hasText || hasFile || hasBuiltIn) {
    return;
  }

  throw new ConfigurationError(`Configured agent "${agentId}" must define prompt.base.text, prompt.base.file, or a built-in base prompt.`);
}
