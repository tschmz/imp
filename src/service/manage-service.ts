import type { ServicePlatform } from "./install-plan.js";
import type { ServiceInstaller } from "./install-service.js";
import { assertServiceDefinitionExists } from "./uninstall-service.js";

export async function startService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<void> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();

  switch (options.platform) {
    case "linux-systemd-user":
      await installer.run("systemctl", ["--user", "start", `${options.serviceName}.service`]);
      return;
    case "macos-launchd-agent": {
      const domainTarget = getLaunchdDomainTarget(options.uid);
      await runIgnoringFailure(installer, "launchctl", [
        "bootstrap",
        domainTarget,
        definitionPath,
      ]);
      await runIgnoringFailure(installer, "launchctl", [
        "kickstart",
        "-k",
        `${domainTarget}/${options.serviceLabel}`,
      ]);
      return;
    }
    case "windows-winsw":
      throw new Error("Automatic Windows service control is not implemented yet.");
  }
}

export async function stopService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<void> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();

  switch (options.platform) {
    case "linux-systemd-user":
      await installer.run("systemctl", ["--user", "stop", `${options.serviceName}.service`]);
      return;
    case "macos-launchd-agent":
      await installer.run("launchctl", ["bootout", getLaunchdDomainTarget(options.uid), definitionPath]);
      return;
    case "windows-winsw":
      throw new Error("Automatic Windows service control is not implemented yet.");
  }
}

export async function restartService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<void> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);
  const installer = options.installer ?? createSystemServiceInstaller();

  switch (options.platform) {
    case "linux-systemd-user":
      await installer.run("systemctl", ["--user", "restart", `${options.serviceName}.service`]);
      return;
    case "macos-launchd-agent": {
      const domainTarget = getLaunchdDomainTarget(options.uid);
      await runIgnoringFailure(installer, "launchctl", ["bootout", domainTarget, definitionPath]);
      await installer.run("launchctl", ["bootstrap", domainTarget, definitionPath]);
      await runIgnoringFailure(installer, "launchctl", [
        "kickstart",
        "-k",
        `${domainTarget}/${options.serviceLabel}`,
      ]);
      return;
    }
    case "windows-winsw":
      throw new Error("Automatic Windows service control is not implemented yet.");
  }
}

function getLaunchdDomainTarget(uid: number | undefined): string {
  const resolvedUid = uid ?? process.getuid?.();
  if (resolvedUid === undefined) {
    throw new Error("Could not determine the current user ID for launchd service control.");
  }

  return `gui/${resolvedUid}`;
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
    // launchd may report bootstrap/bootout failures when the current state already matches the target state.
  }
}
