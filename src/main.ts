#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createCli } from "./cli/create-cli.js";
import { discoverConfigPath, getDefaultUserConfigPath } from "./config/discover-config-path.js";
import { assertInitConfigCanBeCreated, initAppConfig } from "./config/init-app-config.js";
import { loadAppConfig } from "./config/load-app-config.js";
import { promptForInitialAppConfig } from "./config/prompt-init-config.js";
import { resolveRuntimeConfig } from "./config/resolve-runtime-config.js";
import { createDaemon } from "./daemon/create-daemon.js";
import { createFileLogger } from "./logging/file-logger.js";
import { assertServiceInstallCanProceed, installService, resolveServiceDefinitionPath } from "./service/install-service.js";
import { restartService, startService, stopService } from "./service/manage-service.js";
import { createServiceInstallPlan, renderServiceDefinition } from "./service/install-plan.js";
import { uninstallService } from "./service/uninstall-service.js";

async function main(): Promise<void> {
  const cli = createCli({
    startDaemon: runDaemon,
    initConfig: async ({ configPath, force, defaults }) => {
      const resolvedConfigPath = await assertInitConfigCanBeCreated({ configPath, force });
      const config = defaults ? undefined : await resolveInitConfig();
      const createdConfigPath = await initAppConfig({
        configPath: resolvedConfigPath,
        force,
        config,
      });
      console.log(`Created config at ${createdConfigPath}`);
    },
    installService: async ({ configPath, dryRun, force }) => {
      const { configPath: resolvedConfigPath } = await discoverConfigPath({
        cliConfigPath: configPath,
      });
      const plan = createServiceInstallPlan({ configPath: resolvedConfigPath });

      if (dryRun) {
        console.log(renderServiceDefinition(plan));
        return;
      }

      const definitionPath = resolveServiceDefinitionPath({
        platform: plan.platform,
        serviceName: plan.serviceName,
        serviceLabel: plan.serviceLabel,
      });

      await assertServiceInstallCanProceed({
        definitionPath,
        force,
      });

      const result = await installService({ configPath: resolvedConfigPath, force: true });
      console.log(`Installed ${result.platform} service at ${result.definitionPath}`);
    },
    uninstallService: async ({ configPath }) => {
      const resolvedConfigPath = resolveServiceConfigPath(configPath);
      const plan = createServiceInstallPlan({ configPath: resolvedConfigPath });
      const definitionPath = resolveServiceDefinitionPath({
        platform: plan.platform,
        serviceName: plan.serviceName,
        serviceLabel: plan.serviceLabel,
      });
      const result = await uninstallService({
        platform: plan.platform,
        definitionPath,
        serviceName: plan.serviceName,
        serviceLabel: plan.serviceLabel,
      });
      console.log(`Removed ${result.platform} service at ${result.definitionPath}`);
    },
    startService: async ({ configPath }) => {
      const serviceTarget = resolveServiceTarget(configPath);
      await startService(serviceTarget);
      console.log(`Started ${serviceTarget.platform} service ${serviceTarget.serviceName}`);
    },
    stopService: async ({ configPath }) => {
      const serviceTarget = resolveServiceTarget(configPath);
      await stopService(serviceTarget);
      console.log(`Stopped ${serviceTarget.platform} service ${serviceTarget.serviceName}`);
    },
    restartService: async ({ configPath }) => {
      const serviceTarget = resolveServiceTarget(configPath);
      await restartService(serviceTarget);
      console.log(`Restarted ${serviceTarget.platform} service ${serviceTarget.serviceName}`);
    },
  });

  if (process.argv.length <= 2) {
    cli.outputHelp();
    return;
  }

  await cli.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function ensureStartupLogFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}

async function runDaemon(options: { configPath?: string }): Promise<void> {
  const { configPath } = await discoverConfigPath({ cliConfigPath: options.configPath });
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

async function resolveInitConfig() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`imp init` requires an interactive terminal. Re-run with --defaults to skip prompts.");
  }

  try {
    return await promptForInitialAppConfig();
  } catch (error) {
    if (isPromptExitError(error)) {
      throw new Error("Config initialization cancelled.");
    }

    throw error;
  }
}

function isPromptExitError(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}

function resolveServiceConfigPath(cliConfigPath?: string): string {
  if (cliConfigPath) {
    return cliConfigPath;
  }

  return process.env.IMP_CONFIG_PATH ?? getDefaultUserConfigPath(process.env);
}

function resolveServiceTarget(cliConfigPath?: string) {
  const configPath = resolveServiceConfigPath(cliConfigPath);
  const plan = createServiceInstallPlan({ configPath });
  return {
    platform: plan.platform,
    definitionPath: resolveServiceDefinitionPath({
      platform: plan.platform,
      serviceName: plan.serviceName,
      serviceLabel: plan.serviceLabel,
    }),
    serviceName: plan.serviceName,
    serviceLabel: plan.serviceLabel,
  };
}
