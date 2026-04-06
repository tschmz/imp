import { createDaemon } from "../daemon/create-daemon.js";
import type { DaemonConfig } from "../daemon/types.js";
import { AgentExecutionError, AppResult, ConfigError, asAppError } from "../domain/errors.js";
import { resolveRuntimeTarget } from "./runtime-target.js";

export type RunDaemonResult = AppResult<RunDaemonSuccess, RunDaemonError>;

export interface RunDaemonSuccess {
  status: "started";
}

export type RunDaemonError = ConfigError | AgentExecutionError;

export interface DaemonStartupFailureReporter {
  report(options: { runtimeConfig: DaemonConfig; error: RunDaemonError }): Promise<void>;
}

interface RunDaemonUseCaseDependencies {
  resolveRuntimeTarget: typeof resolveRuntimeTarget;
  createDaemon: typeof createDaemon;
  startupFailureReporter: DaemonStartupFailureReporter;
}

export function createRunDaemonUseCase(
  dependencies: Partial<RunDaemonUseCaseDependencies> = {},
): (options: { configPath?: string }) => Promise<RunDaemonResult> {
  const deps: RunDaemonUseCaseDependencies = {
    resolveRuntimeTarget,
    createDaemon,
    startupFailureReporter: {
      report: async () => {
        // no-op default to keep the use case portable in tests and alternative runtimes.
      },
    },
    ...dependencies,
  };

  return async ({ configPath }) => {
    let runtimeConfig: DaemonConfig;

    try {
      const resolved = await deps.resolveRuntimeTarget({ cliConfigPath: configPath });
      runtimeConfig = resolved.runtimeConfig;
    } catch (error) {
      return {
        ok: false,
        error: new ConfigError("Failed to resolve runtime configuration.", {
          cause: error,
          details: { configPath: configPath ?? null },
        }),
      };
    }

    const daemon = deps.createDaemon(runtimeConfig);

    try {
      await daemon.start();
      return { ok: true, value: { status: "started" } };
    } catch (error) {
      const startupError = new AgentExecutionError("Failed to start daemon.", {
        cause: asAppError(error),
        details: {
          failedBotIds: runtimeConfig.activeBots.map((bot) => bot.id),
        },
      });
      await deps.startupFailureReporter.report({ runtimeConfig, error: startupError });
      return {
        ok: false,
        error: startupError,
      };
    }
  };
}
