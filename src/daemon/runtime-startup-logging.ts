import type { AgentRegistry } from "../agents/registry.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";

export async function logRuntimeStartup(
  runtime: BootstrappedRuntime,
  agentRegistry: AgentRegistry,
  loggedAgentStartup: Set<string>,
): Promise<void> {
  const defaultAgent = agentRegistry.get(runtime.endpointConfig.defaultAgentId);
  await runtime.logger.info("starting endpoint runtime", {
    event: "runtime.endpoint.starting",
    component: "runtime-runner",
    defaultAgentId: defaultAgent?.id ?? "unknown",
    paths: {
      dataRoot: runtime.endpointConfig.paths.dataRoot,
      sessionsDir: runtime.endpointConfig.paths.sessionsDir,
      bindingsDir: runtime.endpointConfig.paths.bindingsDir,
      logsDir: runtime.endpointConfig.paths.logsDir,
      logFilePath: runtime.endpointConfig.paths.logFilePath,
      runtimeDir: runtime.endpointConfig.paths.runtimeDir,
      runtimeStatePath: runtime.endpointConfig.paths.runtimeStatePath,
    },
  });

  for (const agent of agentRegistry.list()) {
    if (loggedAgentStartup.has(agent.id)) {
      continue;
    }
    loggedAgentStartup.add(agent.id);

    const agentLogger = runtime.agentLoggers.forAgent(agent.id);
    await agentLogger.info("loaded configured base prompt", {
      event: "agent.config.base_prompt.loaded",
      component: "runtime-runner",
      ...describeBasePrompt(agent.prompt.base),
    });
    await agentLogger.info("loaded configured agent skills", {
      event: "agent.config.skills.loaded",
      component: "runtime-runner",
      configuredSkillNames: (agent.skillCatalog ?? []).map((skill) => skill.name),
    });
    await agentLogger.info("loaded configured instruction files", {
      event: "agent.config.instructions.loaded",
      component: "runtime-runner",
      configuredInstructionFiles: getConfiguredFiles(agent.prompt.instructions),
    });
    await agentLogger.info("loaded configured reference files", {
      event: "agent.config.references.loaded",
      component: "runtime-runner",
      configuredReferenceFiles: getConfiguredFiles(agent.prompt.references),
    });
    for (const issue of agent.skillIssues ?? []) {
      await agentLogger.info(issue, {
        event: "agent.config.skill_issue",
        component: "runtime-runner",
      });
    }
  }

  await runtime.logger.debug("starting transport for endpoint", {
    event: "transport.endpoint.starting",
    component: "runtime-runner",
  });
}

function getConfiguredFiles(sources: Array<{ file?: string }> | undefined): string[] {
  return (sources ?? [])
    .map((source) => source.file)
    .filter((file): file is string => typeof file === "string");
}

function describeBasePrompt(source: { builtIn?: string; file?: string; text?: string }): {
  basePromptSource: "built-in" | "file" | "text" | "unknown";
  basePromptFile?: string;
  basePromptBuiltIn?: string;
} {
  if (source.file) {
    return {
      basePromptSource: "file",
      basePromptFile: source.file,
    };
  }

  if (source.builtIn) {
    return {
      basePromptSource: "built-in",
      basePromptBuiltIn: source.builtIn,
    };
  }

  if (source.text !== undefined) {
    return {
      basePromptSource: "text",
    };
  }

  return {
    basePromptSource: "unknown",
  };
}
