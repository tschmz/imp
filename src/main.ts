#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseCliArgs } from "./cli/parse-cli-args.js";
import { discoverConfigPath } from "./config/discover-config-path.js";
import { initAppConfig } from "./config/init-app-config.js";
import { loadAppConfig } from "./config/load-app-config.js";
import { resolveRuntimeConfig } from "./config/resolve-runtime-config.js";
import { createDaemon } from "./daemon/create-daemon.js";
import { createFileLogger } from "./logging/file-logger.js";

async function main(): Promise<void> {
  const args = parseCliArgs();
  if (args.command === "init") {
    const configPath = await initAppConfig({
      configPath: args.configPath,
      force: args.force,
    });
    console.log(`Created config at ${configPath}`);
    return;
  }

  const { configPath } = await discoverConfigPath({ cliConfigPath: args.configPath });
  const appConfig = await loadAppConfig(configPath);
  const runtimeConfig = resolveRuntimeConfig(appConfig, configPath);
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
}

main().catch((error: unknown) => {
  console.error("daemon failed to start");
  console.error(error);
  process.exitCode = 1;
});

async function ensureStartupLogFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}
