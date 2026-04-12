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
import type { ActiveBotRuntimeConfig, DaemonConfig } from "./types.js";

export interface BootstrappedRuntime {
  botConfig: ActiveBotRuntimeConfig;
  configPath: string;
  logger: ReturnType<typeof buildRuntimeComponents>["logger"];
  loggingLevel: ReturnType<typeof buildRuntimeComponents>["loggingLevel"];
  conversationStore: ReturnType<typeof buildRuntimeComponents>["conversationStore"];
  engine: ReturnType<typeof buildRuntimeComponents>["engine"];
}

export type RuntimeBootstrapDependencies = BuildRuntimeComponentsDependencies;

export async function bootstrapRuntime(
  config: DaemonConfig,
  botConfig: ActiveBotRuntimeConfig,
  dependencies: RuntimeBootstrapDependencies = {},
): Promise<BootstrappedRuntime> {
  let preparedRuntime: PreparedRuntime = { stateAcquired: false };

  try {
    await prepareRuntimeFilesystem(botConfig.paths);
    preparedRuntime = await acquireRuntimeState(config, botConfig);

    const components = buildRuntimeComponents(config, botConfig, dependencies);

    await components.logger.debug("initialized bot runtime state", {
      botId: botConfig.id,
    });

    return {
      botConfig,
      configPath: config.configPath,
      ...components,
    };
  } catch (error) {
    await cleanupPreparedRuntime(preparedRuntime, botConfig);
    throw error;
  }
}
