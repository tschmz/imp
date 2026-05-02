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

interface SkippedAgent {
  agentId: string;
  error: unknown;
}

export function createDaemon(
  config: DaemonConfig,
  dependencies: DaemonDependencies,
): Daemon {
  const createBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;

  return {
    async start() {
      const createRuntimeToolRegistry = createRuntimeToolRegistryFactory(createBuiltInRegistry, config.pluginTools ?? []);
      const { agentRegistry, skippedAgents } = buildOperationalAgentRegistry(
        config,
        dependencies.agentRegistry,
        dependencies.toolRegistry,
        createRuntimeToolRegistry,
      );
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
              try {
                await runtime.engine.close?.();
              } finally {
                await runtime.closeAgentRuntimeSurface?.();
              }
            } finally {
              await cleanupRuntimeState(runtime.endpointConfig.paths.runtimeStatePath);
            }
          }),
        );
        throw error;
      }
      await logSkippedAgents(runtimes, skippedAgents);
      const runtimeControl = createDeferredActionController<RuntimeControlAction>();
      const runtimeEntries = createRuntimeEntries(runtimes, {
        agentRegistry,
        createTransport: dependencies.createTransport,
        requestControlAction: (action) => {
          runtimeControl.request(action);
        },
        enableCronScheduler: true,
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

function buildOperationalAgentRegistry(
  config: DaemonConfig,
  configuredAgentRegistry: ReturnType<typeof createAgentRegistry> | undefined,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string | WorkingDirectoryState, agent?: AgentDefinition) => ToolRegistry,
): { agentRegistry: ReturnType<typeof createAgentRegistry>; skippedAgents: SkippedAgent[] } {
  const requiredAgentIds = new Set(config.activeEndpoints.map((endpoint) => endpoint.defaultAgentId));
  const skippedAgents: SkippedAgent[] = [];
  let agents = configuredAgentRegistry?.list() ?? buildOptionalAgents(config.agents, requiredAgentIds, skippedAgents);

  while (true) {
    const agentRegistry = createAgentRegistry(agents);
    const invalidAgents = findInvalidAgents(agentRegistry, toolRegistry, createBuiltInRegistry);
    if (invalidAgents.length === 0) {
      return { agentRegistry, skippedAgents };
    }

    const fatalInvalidAgent = invalidAgents.find((issue) => requiredAgentIds.has(issue.agent.id));
    if (fatalInvalidAgent) {
      throw fatalInvalidAgent.error;
    }

    const invalidAgentIds = new Set(invalidAgents.map((issue) => issue.agent.id));
    skippedAgents.push(...invalidAgents.map((issue) => ({ agentId: issue.agent.id, error: issue.error })));
    agents = agents.filter((agent) => !invalidAgentIds.has(agent.id));
  }
}

function buildOptionalAgents(
  configuredAgents: DaemonConfig["agents"],
  requiredAgentIds: Set<string>,
  skippedAgents: SkippedAgent[],
): AgentDefinition[] {
  const agents: AgentDefinition[] = [];

  for (const configuredAgent of configuredAgents) {
    try {
      agents.push(buildAgent(configuredAgent));
    } catch (error) {
      if (requiredAgentIds.has(configuredAgent.id)) {
        throw error;
      }
      skippedAgents.push({ agentId: configuredAgent.id, error });
    }
  }

  return agents;
}

function findInvalidAgents(
  agentRegistry: ReturnType<typeof createAgentRegistry>,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string | WorkingDirectoryState, agent?: AgentDefinition) => ToolRegistry,
): Array<{ agent: AgentDefinition; error: unknown }> {
  const invalidAgents: Array<{ agent: AgentDefinition; error: unknown }> = [];

  for (const agent of agentRegistry.list()) {
    try {
      validateAgent(agent, agentRegistry, toolRegistry, createBuiltInRegistry);
    } catch (error) {
      invalidAgents.push({ agent, error });
    }
  }

  return invalidAgents;
}

async function logSkippedAgents(runtimes: BootstrappedRuntime[], skippedAgents: SkippedAgent[]): Promise<void> {
  if (skippedAgents.length === 0) {
    return;
  }

  await Promise.all(
    runtimes.flatMap((runtime) =>
      skippedAgents.map((skipped) =>
        runtime.logger.error("skipping invalid agent", {
          endpointId: runtime.endpointConfig.id,
          agentId: skipped.agentId,
          errorMessage: formatError(skipped.error),
        }, skipped.error),
      ),
    ),
  );
}


function createRuntimeToolRegistryFactory(
  createBuiltInRegistry: typeof createBuiltInToolRegistry,
  pluginTools: NonNullable<DaemonConfig["pluginTools"]>,
): typeof createBuiltInToolRegistry {
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

export function validateAgentRegistry(
  agentRegistry: ReturnType<typeof createAgentRegistry>,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string | WorkingDirectoryState, agent?: AgentDefinition) => ToolRegistry,
): void {
  for (const agent of agentRegistry.list()) {
    validateAgent(agent, agentRegistry, toolRegistry, createBuiltInRegistry);
  }
}

export function buildAgents(configuredAgents: DaemonConfig["agents"]): AgentDefinition[] {
  return configuredAgents.map(buildAgent);
}

function buildAgent(configuredAgent: DaemonConfig["agents"][number]): AgentDefinition {
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
}

function validateAgent(
  agent: AgentDefinition,
  agentRegistry: ReturnType<typeof createAgentRegistry>,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string | WorkingDirectoryState, agent?: AgentDefinition) => ToolRegistry,
): void {
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
