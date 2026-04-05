import { cleanupRuntimeState } from "./runtime-state.js";
import { stopRuntimeEntries, type RuntimeEntry } from "./runtime-runner.js";

export interface RuntimeLifecycleProcess {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  exit(code?: number): never;
}

export interface RuntimeShutdown {
  registerSignalHandlers(): { dispose(): void };
  shutdown(): Promise<void>;
}

export function createRuntimeShutdown(
  entries: RuntimeEntry[],
  runtimeStatePaths: string[],
  runtimeProcess: RuntimeLifecycleProcess = process,
): RuntimeShutdown {
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      try {
        await stopRuntimeEntries(entries);
      } finally {
        await Promise.all(
          runtimeStatePaths.map(async (runtimeStatePath) => cleanupRuntimeState(runtimeStatePath)),
        );
      }
    })();

    return shutdownPromise;
  };

  return {
    registerSignalHandlers() {
      const handleSigint = () => {
        void shutdown().finally(() => {
          runtimeProcess.exit(130);
        });
      };

      const handleSigterm = () => {
        void shutdown().finally(() => {
          runtimeProcess.exit(0);
        });
      };

      runtimeProcess.once("SIGINT", handleSigint);
      runtimeProcess.once("SIGTERM", handleSigterm);

      return {
        dispose() {
          runtimeProcess.off("SIGINT", handleSigint);
          runtimeProcess.off("SIGTERM", handleSigterm);
        },
      };
    },
    shutdown,
  };
}
