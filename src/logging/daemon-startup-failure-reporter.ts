import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DaemonStartupFailureReporter } from "../application/run-daemon-use-case.js";
import { createFileLogger } from "./file-logger.js";

export function createDaemonStartupFailureReporter(): DaemonStartupFailureReporter {
  return {
    report: async ({ runtimeConfig, error }) => {
      await Promise.all(
        runtimeConfig.activeBots.map(async (bot) => {
          await ensureStartupLogFile(bot.paths.logFilePath);
          const logger = createFileLogger(bot.paths.logFilePath, runtimeConfig.logging.level);
          await logger.error("daemon failed to start", { botId: bot.id }, error);
        }),
      );
    },
  };
}

async function ensureStartupLogFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}
