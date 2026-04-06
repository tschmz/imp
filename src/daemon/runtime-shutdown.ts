import { cleanupRuntimeState } from "./runtime-state.js";
import { stopRuntimeEntries, type RuntimeEntry } from "./runtime-runner.js";

export type RuntimeControlAction = "reload" | "restart";

export interface RuntimeLifecycleProcess {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  exit(code?: number): never;
}

export interface RuntimeShutdown {
  registerSignalHandlers(): { dispose(): void };
  shutdown(): Promise<void>;
  requestControlAction(action: RuntimeControlAction): void;
}

export function createRuntimeShutdown(
  entries: RuntimeEntry[],
  runtimeStatePaths: string[],
  runtimeProcess: RuntimeLifecycleProcess = process,
): RuntimeShutdown {
  let shutdownPromise: Promise<void> | undefined;
  let exitStarted = false;

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

  const beginExit = (code: number): void => {
    if (exitStarted) {
      return;
    }
    exitStarted = true;

    void shutdown().finally(() => {
      runtimeProcess.exit(code);
    });
  };

  return {
    registerSignalHandlers() {
      const handleSigint = () => {
        beginExit(130);
      };

      const handleSigterm = () => {
        beginExit(0);
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
    requestControlAction(action) {
      void action;
      beginExit(75);
    },
  };
}
