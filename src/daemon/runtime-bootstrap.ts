import {
  acquireRuntimeState,
  cleanupPreparedRuntime,
  type PreparedRuntime,
} from "./bootstrap/acquire-runtime-state.js";
import {
  buildRuntimeComponents,
  type BuildRuntimeComponentsDependencies,
} from "./bootstrap/build-runtime-components.js";
import { prepareRuntimeFilesystem } from "./bootstrap/prepare-runtime-filesystem.js";
import type { ActiveEndpointRuntimeConfig, DaemonConfig } from "./types.js";

export interface BootstrappedRuntime {
  endpointConfig: ActiveEndpointRuntimeConfig;
  configPath: string;
  logger: ReturnType<typeof buildRuntimeComponents>["logger"];
  endpointLogger: ReturnType<typeof buildRuntimeComponents>["endpointLogger"];
  agentLoggers: ReturnType<typeof buildRuntimeComponents>["agentLoggers"];
  loggingLevel: ReturnType<typeof buildRuntimeComponents>["loggingLevel"];
  conversationStore: ReturnType<typeof buildRuntimeComponents>["conversationStore"];
  engine: ReturnType<typeof buildRuntimeComponents>["engine"];
}

export type RuntimeBootstrapDependencies = BuildRuntimeComponentsDependencies;

export async function bootstrapRuntime(
  config: DaemonConfig,
  endpointConfig: ActiveEndpointRuntimeConfig,
  dependencies: RuntimeBootstrapDependencies = {},
): Promise<BootstrappedRuntime> {
  let preparedRuntime: PreparedRuntime = { stateAcquired: false };

  try {
    await prepareRuntimeFilesystem(endpointConfig.paths);
    preparedRuntime = await acquireRuntimeState(config, endpointConfig);

    const components = buildRuntimeComponents(config, endpointConfig, dependencies);
    const interruptedRunCount = await components.conversationStore.markInterruptedRuns?.(
      new Date().toISOString(),
    ) ?? 0;

    await components.logger.debug("initialized endpoint runtime state", {
      endpointId: endpointConfig.id,
    });
    if (interruptedRunCount > 0) {
      await components.logger.info("marked interrupted conversation runs", {
        endpointId: endpointConfig.id,
        interruptedRunCount,
      });
    }

    return {
      endpointConfig,
      configPath: config.configPath,
      ...components,
    };
  } catch (error) {
    await cleanupPreparedRuntime(preparedRuntime, endpointConfig);
    throw error;
  }
}
