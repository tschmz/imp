import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createDaemon } from "../daemon/create-daemon.js";
import { createFileLogger } from "../logging/file-logger.js";
import { resolveRuntimeTarget } from "./runtime-target.js";

export function createRunDaemonUseCase(): (options: { configPath?: string }) => Promise<void> {
  return async ({ configPath }) => {
    const { runtimeConfig } = await resolveRuntimeTarget({ cliConfigPath: configPath });
    const daemon = createDaemon(runtimeConfig);

    try {
      await daemon.start();
    } catch (error) {
      await Promise.all(
        runtimeConfig.activeBots.map(async (bot) => {
          await ensureStartupLogFile(bot.paths.logFilePath);
          const logger = createFileLogger(bot.paths.logFilePath, runtimeConfig.logging.level);
          await logger.error("daemon failed to start", { botId: bot.id }, error);
        }),
      );
      process.exitCode = 1;
    }
  };
}

async function ensureStartupLogFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}
