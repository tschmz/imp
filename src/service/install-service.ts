import { homedir } from "node:os";
import { resolve } from "node:path";
import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import {
  createServiceInstallPlan,
  type ServiceInstallPlan,
  type ServicePlatform,
  renderServiceDefinition,
} from "./install-plan.js";

export interface ServiceInstaller {
  run(command: string, args: string[]): Promise<void>;
}

export interface ServiceInstallResult {
  platform: ServicePlatform;
  definitionPath: string;
  plan: ServiceInstallPlan;
}

export async function installService(options: {
  configPath: string;
  argv?: string[];
  execPath?: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  uid?: number;
  installer?: ServiceInstaller;
  force?: boolean;
  now?: Date;
}): Promise<ServiceInstallResult> {
  const plan = createServiceInstallPlan({
    configPath: options.configPath,
    argv: options.argv,
    execPath: options.execPath,
    platform: options.platform,
  });
  const definitionPath = resolveServiceDefinitionPath({
    platform: plan.platform,
    homeDir: options.homeDir,
    serviceName: plan.serviceName,
    serviceLabel: plan.serviceLabel,
  });
  const definition = renderServiceDefinition(plan);
  await writeManagedFile({
    path: definitionPath,
    resourceLabel: "Service definition",
    content: `${definition}\n`,
    force: options.force,
    now: options.now,
  });

  const installer = options.installer ?? createSystemServiceInstaller();
  await activateInstalledService({
    installer,
    definitionPath,
    plan,
    uid: options.uid,
  });

  return {
    platform: plan.platform,
    definitionPath,
    plan,
  };
}

export async function assertServiceInstallCanProceed(options: {
  definitionPath: string;
  force?: boolean;
}): Promise<string> {
  return assertManagedFileCanBeWritten({
    path: resolve(options.definitionPath),
    resourceLabel: "Service definition",
    force: options.force,
  });
}

export function resolveServiceDefinitionPath(options: {
  platform: ServicePlatform;
  homeDir?: string;
  serviceName: string;
  serviceLabel: string;
}): string {
  const userHome = resolve(options.homeDir ?? homedir());

  switch (options.platform) {
    case "linux-systemd-user":
      return resolve(userHome, ".config", "systemd", "user", `${options.serviceName}.service`);
    case "macos-launchd-agent":
      return resolve(userHome, "Library", "LaunchAgents", `${options.serviceLabel}.plist`);
    case "windows-winsw":
      throw new Error("Automatic Windows service installation is not implemented yet.");
  }
}

async function activateInstalledService(options: {
  installer: ServiceInstaller;
  definitionPath: string;
  plan: ServiceInstallPlan;
  uid?: number;
}): Promise<void> {
  switch (options.plan.platform) {
    case "linux-systemd-user":
      await options.installer.run("systemctl", ["--user", "daemon-reload"]);
      await options.installer.run("systemctl", ["--user", "enable", "--now", `${options.plan.serviceName}.service`]);
      return;
    case "macos-launchd-agent": {
      const uid = options.uid ?? process.getuid?.();
      if (uid === undefined) {
        throw new Error("Could not determine the current user ID for launchd service installation.");
      }

      const domainTarget = `gui/${uid}`;
      await runIgnoringFailure(options.installer, "launchctl", [
        "bootout",
        domainTarget,
        options.definitionPath,
      ]);
      await options.installer.run("launchctl", ["bootstrap", domainTarget, options.definitionPath]);
      await options.installer.run("launchctl", ["kickstart", "-k", `${domainTarget}/${options.plan.serviceLabel}`]);
      return;
    }
    case "windows-winsw":
      throw new Error("Automatic Windows service installation is not implemented yet.");
  }
}

function createSystemServiceInstaller(): ServiceInstaller {
  return {
    async run(command: string, args: string[]) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync(command, args, {
        env: process.env,
      });
    },
  };
}

async function runIgnoringFailure(
  installer: ServiceInstaller,
  command: string,
  args: string[],
): Promise<void> {
  try {
    await installer.run(command, args);
  } catch {
    // launchd returns an error when the agent is not loaded yet.
  }
}
