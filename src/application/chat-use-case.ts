import { createAgentRegistry } from "../agents/registry.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import { resolveRuntimeConfig } from "../config/resolve-runtime-config.js";
import type { AppConfig, CliEndpointConfig } from "../config/types.js";
import { buildRuntimeComponents } from "../daemon/bootstrap/build-runtime-components.js";
import { prepareRuntimeFilesystem } from "../daemon/bootstrap/prepare-runtime-filesystem.js";
import { buildAgents, validateAgentRegistry } from "../daemon/create-daemon.js";
import type { BootstrappedRuntime } from "../daemon/runtime-bootstrap.js";
import { createRuntimeEntries, runRuntimeEntries, stopRuntimeEntries } from "../daemon/runtime-runner.js";
import type { DaemonConfig } from "../daemon/types.js";
import { ConfigurationError } from "../domain/errors.js";
import { prepareAgentLogFiles } from "../logging/agent-loggers.js";
import { createFileOnlyLogger } from "../logging/file-logger.js";
import { createBuiltInToolRegistry } from "../runtime/create-pi-agent-engine.js";
import { createRuntimeTransportFactory } from "./runtime-target.js";

interface ChatUseCaseDependencies {
  discoverConfigPath: typeof discoverConfigPath;
  loadAppConfig: typeof loadAppConfig;
  resolveRuntimeConfig: typeof resolveRuntimeConfig;
  prepareRuntimeFilesystem: typeof prepareRuntimeFilesystem;
  prepareAgentLogFiles: typeof prepareAgentLogFiles;
  buildRuntimeComponents: typeof buildRuntimeComponents;
  createRuntimeEntries: typeof createRuntimeEntries;
  runRuntimeEntries: typeof runRuntimeEntries;
  stopRuntimeEntries: typeof stopRuntimeEntries;
}

export function createChatUseCase(
  dependencies: Partial<ChatUseCaseDependencies> = {},
): (options: { configPath?: string; endpointId?: string }) => Promise<void> {
  const deps: ChatUseCaseDependencies = {
    discoverConfigPath,
    loadAppConfig,
    resolveRuntimeConfig,
    prepareRuntimeFilesystem,
    prepareAgentLogFiles,
    buildRuntimeComponents,
    createRuntimeEntries,
    runRuntimeEntries,
    stopRuntimeEntries,
    ...dependencies,
  };

  return async ({ configPath, endpointId }) => {
    const { configPath: resolvedConfigPath } = await deps.discoverConfigPath({
      cliConfigPath: configPath,
    });
    const appConfig = await deps.loadAppConfig(resolvedConfigPath);
    const chatEndpoint = resolveCliChatEndpoint(appConfig, endpointId);

    const runtimeConfig = await deps.resolveRuntimeConfig(
      {
        ...appConfig,
        endpoints: [chatEndpoint],
      },
      resolvedConfigPath,
      {
        includeCliEndpoints: true,
      },
    );
    const chatRuntimeConfig = resolveCliChatRuntimeConfig(runtimeConfig);
    const agentRegistry = createAgentRegistry(buildAgents(chatRuntimeConfig.agents));
    validateAgentRegistry(agentRegistry, undefined, createBuiltInToolRegistry);
    await deps.prepareAgentLogFiles(
      chatRuntimeConfig.activeEndpoints.map((endpoint) => endpoint.paths.dataRoot),
      agentRegistry.list().map((agent) => agent.id),
    );

    const runtimes = await Promise.all(
      chatRuntimeConfig.activeEndpoints.map(async (endpointConfig): Promise<BootstrappedRuntime> => {
        await deps.prepareRuntimeFilesystem(endpointConfig.paths);
        const components = deps.buildRuntimeComponents(chatRuntimeConfig, endpointConfig, {
          createLogger: createFileOnlyLogger,
        });
        return {
          endpointConfig,
          configPath: chatRuntimeConfig.configPath,
          ...components,
        };
      }),
    );
    const runtimeEntries = deps.createRuntimeEntries(runtimes, {
      agentRegistry,
      createTransport: createRuntimeTransportFactory,
      requestControlAction: async () => {
        await deps.stopRuntimeEntries(runtimeEntries);
      },
    });

    try {
      await deps.runRuntimeEntries(runtimeEntries);
    } finally {
      await deps.stopRuntimeEntries(runtimeEntries);
    }
  };
}

const defaultCliEndpointId = "local-cli";

function resolveCliChatEndpoint(appConfig: AppConfig, endpointId: string | undefined): CliEndpointConfig {
  const cliEndpoints = appConfig.endpoints.filter((endpoint): endpoint is CliEndpointConfig => endpoint.type === "cli");

  if (endpointId) {
    const endpoint = cliEndpoints.find((candidate) => candidate.id === endpointId);
    if (!endpoint) {
      throw new ConfigurationError(`No CLI endpoint found with id "${endpointId}".`);
    }

    return normalizeChatEndpoint(endpoint);
  }

  const defaultEndpoint =
    cliEndpoints.find((endpoint) => endpoint.id === defaultCliEndpointId) ??
    (cliEndpoints.length === 1 ? cliEndpoints[0] : undefined);

  if (defaultEndpoint) {
    return normalizeChatEndpoint(defaultEndpoint);
  }

  if (cliEndpoints.length > 1) {
    throw new ConfigurationError(
      `Multiple CLI endpoints are configured. Pass --endpoint with one of: ${cliEndpoints
        .map((endpoint) => endpoint.id)
        .sort()
        .join(", ")}.`,
    );
  }

  return {
    id: defaultCliEndpointId,
    type: "cli",
    enabled: true,
  };
}

function normalizeChatEndpoint(endpoint: CliEndpointConfig): CliEndpointConfig {
  return {
    ...endpoint,
    enabled: true,
    routing: undefined,
  };
}

function resolveCliChatRuntimeConfig(runtimeConfig: DaemonConfig): DaemonConfig {
  return {
    ...runtimeConfig,
    activeEndpoints: runtimeConfig.activeEndpoints.filter((endpoint) => endpoint.type === "cli"),
  };
}
