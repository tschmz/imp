import { createDaemon } from "../daemon/create-daemon.js";
import { RuntimeStateError } from "../domain/errors.js";
import type { DaemonConfig } from "../daemon/types.js";
import { resolveRuntimeTarget } from "./runtime-target.js";

export type RunDaemonOutcome = RunDaemonSuccessOutcome | RunDaemonStartupFailureOutcome;

export interface RunDaemonSuccessOutcome {
  status: "started";
}

export interface RunDaemonStartupFailureOutcome {
  status: "startup_failed";
  error: unknown;
  failedBotIds: string[];
}

export interface DaemonStartupFailureReporter {
  report(options: { runtimeConfig: DaemonConfig; error: unknown }): Promise<void>;
}

interface RunDaemonUseCaseDependencies {
  resolveRuntimeTarget: typeof resolveRuntimeTarget;
  createDaemon: typeof createDaemon;
  startupFailureReporter: DaemonStartupFailureReporter;
}

export function createRunDaemonUseCase(
  dependencies: Partial<RunDaemonUseCaseDependencies> = {},
): (options: { configPath?: string }) => Promise<RunDaemonOutcome> {
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
    const { runtimeConfig, createTransport } = await deps.resolveRuntimeTarget({
      cliConfigPath: configPath,
    });
    const daemon = deps.createDaemon(runtimeConfig, { createTransport });

    try {
      await daemon.start();
      return { status: "started" };
    } catch (error) {
      await deps.startupFailureReporter.report({ runtimeConfig, error });
      return {
        status: "startup_failed",
        error: normalizeRunDaemonError(error),
        failedBotIds: runtimeConfig.activeEndpoints.map((endpoint) => endpoint.id),
      };
    }
  };
}


function normalizeRunDaemonError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new RuntimeStateError("Daemon startup failed with a non-Error value.", {
    cause: error,
  });
}
