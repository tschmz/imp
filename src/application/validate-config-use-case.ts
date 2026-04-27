import { readFile, stat } from "node:fs/promises";
import { createAgentRegistry } from "../agents/registry.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import { resolveRuntimeConfig } from "../config/resolve-runtime-config.js";
import { validateAppConfigSecretReferences } from "../config/validate-secret-references.js";
import { buildAgents, validateAgentRegistry } from "../daemon/create-daemon.js";
import type { DaemonConfig } from "../daemon/types.js";
import { createBuiltInToolRegistry, resolveWorkingDirectory } from "../runtime/create-pi-agent-engine.js";
import {
  createDefaultPromptTemplateSystemContext,
  createPromptTemplateContext,
} from "../runtime/prompt-template.js";
import { InMemoryCacheStrategy, SystemPromptCache } from "../runtime/system-prompt-cache.js";
import { resolveSystemPrompt } from "../runtime/system-prompt-resolution.js";
import { createToolRegistry } from "../tools/registry.js";

interface ValidateConfigUseCaseDependencies {
  writeOutput: (line: string) => void;
}

interface ValidateConfigOptions {
  configPath?: string;
  preflight?: boolean;
}

export function createValidateConfigUseCase(
  dependencies: Partial<ValidateConfigUseCaseDependencies> = {},
): (options: ValidateConfigOptions) => Promise<void> {
  const deps: ValidateConfigUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath, preflight = false }) => {
    const { configPath: resolvedConfigPath } = await discoverConfigPath({
      cliConfigPath: configPath,
    });
    const appConfig = await loadAppConfig(resolvedConfigPath);
    await validateAppConfigSecretReferences(appConfig, resolvedConfigPath);

    if (preflight) {
      const runtimeConfig = await resolveRuntimeConfig(appConfig, resolvedConfigPath, {
        includeCliEndpoints: true,
      });
      await validateAgentPreflight(runtimeConfig);
      deps.writeOutput(`Agent preflight valid: ${runtimeConfig.agents.length} agent(s)`);
    }

    deps.writeOutput(`Config valid: ${resolvedConfigPath}`);
  };
}

async function validateAgentPreflight(runtimeConfig: DaemonConfig): Promise<void> {
  const agentRegistry = createAgentRegistry(buildAgents(runtimeConfig.agents));
  validateAgentRegistry(agentRegistry, undefined, (workingDirectory, agent) => {
    const builtInRegistry = createBuiltInToolRegistry(workingDirectory, agent);
    return runtimeConfig.pluginTools && runtimeConfig.pluginTools.length > 0
      ? createToolRegistry([...builtInRegistry.list(), ...runtimeConfig.pluginTools])
      : builtInRegistry;
  });

  await Promise.all(
    agentRegistry.list().map(async (agent) => {
      await resolveSystemPrompt({
        agent,
        promptWorkingDirectory: resolveWorkingDirectory(agent),
        templateContext: createPromptTemplateContext({
          system: createDefaultPromptTemplateSystemContext(),
          agent,
          endpointId: runtimeConfig.activeEndpoints[0]?.id ?? "preflight",
          transportKind: runtimeConfig.activeEndpoints[0]?.type ?? "preflight",
          configPath: runtimeConfig.configPath,
          dataRoot: runtimeConfig.activeEndpoints[0]?.paths.dataRoot,
          availableSkills: agent.skillCatalog,
        }),
        availableSkills: agent.skillCatalog,
        readTextFile: readTextFileUtf8,
        cache: new SystemPromptCache({
          readTextFile: readTextFileUtf8,
          getContextFileFingerprint,
          strategy: new InMemoryCacheStrategy<string>(),
        }),
      });
    }),
  );
}

async function readTextFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function getContextFileFingerprint(path: string): Promise<string> {
  const fileStats = await stat(path);
  return `${fileStats.mtimeMs}:${fileStats.size}`;
}
