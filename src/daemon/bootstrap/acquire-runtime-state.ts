import { cleanupRuntimeState, assertNoRunningInstance, writeRuntimeState } from "../runtime-state.js";
import type { ActiveEndpointRuntimeConfig, DaemonConfig } from "../types.js";

export interface PreparedRuntime {
  stateAcquired: boolean;
}

export async function acquireRuntimeState(
  config: DaemonConfig,
  endpointConfig: ActiveEndpointRuntimeConfig,
): Promise<PreparedRuntime> {
  await assertNoRunningInstance(endpointConfig.paths.runtimeStatePath);
  await writeRuntimeState(endpointConfig.paths.runtimeStatePath, {
    pid: process.pid,
    endpointId: endpointConfig.id,
    startedAt: new Date().toISOString(),
    configPath: config.configPath,
    logFilePath: endpointConfig.paths.logFilePath,
  });

  return { stateAcquired: true };
}

export async function cleanupPreparedRuntime(
  prepared: PreparedRuntime,
  endpointConfig: ActiveEndpointRuntimeConfig,
): Promise<void> {
  if (!prepared.stateAcquired) {
    return;
  }

  await cleanupRuntimeState(endpointConfig.paths.runtimeStatePath);
}
