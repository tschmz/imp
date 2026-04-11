import { cleanupRuntimeState, assertNoRunningInstance, writeRuntimeState } from "../runtime-state.js";
import type { ActiveBotRuntimeConfig, DaemonConfig } from "../types.js";

export interface PreparedRuntime {
  stateAcquired: boolean;
}

export async function acquireRuntimeState(
  config: DaemonConfig,
  botConfig: ActiveBotRuntimeConfig,
): Promise<PreparedRuntime> {
  await assertNoRunningInstance(botConfig.paths.runtimeStatePath);
  await writeRuntimeState(botConfig.paths.runtimeStatePath, {
    pid: process.pid,
    botId: botConfig.id,
    startedAt: new Date().toISOString(),
    configPath: config.configPath,
    logFilePath: botConfig.paths.logFilePath,
  });

  return { stateAcquired: true };
}

export async function cleanupPreparedRuntime(
  prepared: PreparedRuntime,
  botConfig: ActiveBotRuntimeConfig,
): Promise<void> {
  if (!prepared.stateAcquired) {
    return;
  }

  await cleanupRuntimeState(botConfig.paths.runtimeStatePath);
}
