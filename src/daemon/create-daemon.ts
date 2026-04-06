import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { Logger } from "../logging/types.js";
import {
  createBuiltInToolRegistry,
  resolveAgentTools,
  resolveWorkingDirectory,
} from "../runtime/create-pi-agent-engine.js";
import type { ToolRegistry } from "../tools/registry.js";
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
  type RuntimeLifecycleProcess,
} from "./runtime-shutdown.js";
import { cleanupRuntimeState } from "./runtime-state.js";
import type { ActiveBotRuntimeConfig, Daemon, DaemonConfig } from "./types.js";

interface DaemonDependencies extends RuntimeBootstrapDependencies {
  agentRegistry?: ReturnType<typeof createAgentRegistry>;
  createTransport: TransportFactory<ActiveBotRuntimeConfig, Logger>;
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
      validateAgentRegistry(agentRegistry, dependencies.toolRegistry, createBuiltInRegistry);
      const runtimes: BootstrappedRuntime[] = [];

      try {
        for (const botConfig of config.activeBots) {
          runtimes.push(await bootstrapRuntime(config, botConfig, dependencies));
        }
      } catch (error) {
        await Promise.all(
          runtimes.map(async (runtime) => cleanupRuntimeState(runtime.botConfig.paths.runtimeStatePath)),
        );
        throw error;
      }
      const runtimeControl = {
        requestAction: (() => {}) as (action: "reload" | "restart") => void,
      };
      const runtimeEntries = createRuntimeEntries(runtimes, {
        agentRegistry,
        createTransport: dependencies.createTransport,
        requestControlAction: (action) => {
          runtimeControl.requestAction(action);
        },
      });
      const shutdown = createRuntimeShutdown(
        runtimeEntries,
        runtimes.map((runtime) => runtime.botConfig.paths.runtimeStatePath),
        dependencies.runtimeProcess,
      );
      runtimeControl.requestAction = (action) => {
        shutdown.requestControlAction(action);
      };
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

function validateAgentRegistry(
  agentRegistry: ReturnType<typeof createAgentRegistry>,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string, agent?: AgentDefinition) => ToolRegistry,
): void {
  for (const agent of agentRegistry.list()) {
    const registry = toolRegistry ?? createBuiltInRegistry(resolveWorkingDirectory(agent), agent);
    resolveAgentTools(agent, registry);
  }
}

function buildAgents(configuredAgents: DaemonConfig["agents"]): AgentDefinition[] {
  return configuredAgents.map((configuredAgent) => {
    if (!configuredAgent.systemPrompt && !configuredAgent.systemPromptFile) {
      throw new Error(
        `Configured agent "${configuredAgent.id}" must define systemPrompt or systemPromptFile.`,
      );
    }

    if (!configuredAgent.model) {
      throw new Error(`Configured agent "${configuredAgent.id}" must define model.`);
    }

    return {
      id: configuredAgent.id,
      name: configuredAgent.name ?? configuredAgent.id,
      ...(configuredAgent.systemPrompt ? { systemPrompt: configuredAgent.systemPrompt } : {}),
      ...(configuredAgent.systemPromptFile
        ? { systemPromptFile: configuredAgent.systemPromptFile }
        : {}),
      model: configuredAgent.model,
      ...(configuredAgent.authFile ? { authFile: configuredAgent.authFile } : {}),
      ...(configuredAgent.inference ? { inference: configuredAgent.inference } : {}),
      ...(configuredAgent.context ? { context: configuredAgent.context } : {}),
      tools: configuredAgent.tools ?? [],
      extensions: [],
    };
  });
}
