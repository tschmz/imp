import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DaemonStartupFailureReporter } from "../application/run-daemon-use-case.js";
import { createFileLogger } from "./file-logger.js";

interface DaemonStartupFailureReporterDependencies {
  createLogger?: typeof createFileLogger;
}

export function createDaemonStartupFailureReporter(
  dependencies: DaemonStartupFailureReporterDependencies = {},
): DaemonStartupFailureReporter {
  const createLogger = dependencies.createLogger ?? createFileLogger;
  return {
    report: async ({ runtimeConfig, error }) => {
      await Promise.all(
        runtimeConfig.activeEndpoints.map(async (endpoint) => {
          await ensureStartupLogFile(endpoint.paths.logFilePath);
          const logger = createLogger(endpoint.paths.logFilePath, runtimeConfig.logging.level, {
            rotationSize: runtimeConfig.logging.rotationSize,
          });
          try {
            await logger.error("daemon failed to start", { endpointId: endpoint.id }, error);
          } finally {
            await logger.close?.();
          }
        }),
      );
    },
  };
}

async function ensureStartupLogFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}
