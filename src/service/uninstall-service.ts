import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { ServicePlatform } from "./install-plan.js";
import type { ServiceInstaller } from "./install-service.js";

export interface ServiceUninstallResult {
  platform: ServicePlatform;
  definitionPath: string;
}

export async function uninstallService(options: {
  platform: ServicePlatform;
  definitionPath: string;
  serviceName: string;
  serviceLabel: string;
  uid?: number;
  installer?: ServiceInstaller;
}): Promise<ServiceUninstallResult> {
  const definitionPath = await assertServiceDefinitionExists(options.definitionPath);

  switch (options.platform) {
    case "linux-systemd-user": {
      const installer = options.installer ?? createSystemServiceInstaller();
      await runIgnoringFailure(installer, "systemctl", [
        "--user",
        "disable",
        "--now",
        `${options.serviceName}.service`,
      ]);
      await installer.run("systemctl", ["--user", "daemon-reload"]);
      break;
    }
    case "macos-launchd-agent": {
      const installer = options.installer ?? createSystemServiceInstaller();
      const uid = options.uid ?? process.getuid?.();
      if (uid === undefined) {
        throw new Error("Could not determine the current user ID for launchd service removal.");
      }
      await runIgnoringFailure(installer, "launchctl", ["bootout", `gui/${uid}`, definitionPath]);
      break;
    }
    case "windows-winsw":
      throw new Error("Automatic Windows service uninstallation is not implemented yet.");
  }

  await rm(definitionPath, { force: true });
  return {
    platform: options.platform,
    definitionPath,
  };
}

export async function assertServiceDefinitionExists(definitionPath: string): Promise<string> {
  const resolvedPath = resolve(definitionPath);

  try {
    await access(resolvedPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Service definition not found: ${resolvedPath}`);
    }
    throw error;
  }

  return resolvedPath;
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
    // Uninstall should still remove the definition when the service is already inactive.
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
