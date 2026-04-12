import { dirname, resolve } from "node:path";
import { RuntimeStateError, UnsupportedPlatformError } from "../domain/errors.js";
import { getServicePlatformAdapter } from "./platforms/get-service-platform-adapter.js";

export type ServicePlatform = "linux-systemd-user" | "macos-launchd-agent" | "windows-winsw";
export type ServicePlatformInput = NodeJS.Platform | ServicePlatform;

export interface ServiceInstallPlan {
  platform: ServicePlatform;
  serviceName: string;
  serviceLabel: string;
  configPath: string;
  workingDirectory: string;
  command: string;
  args: string[];
  environmentPath?: string;
}

export function createServiceInstallPlan(options: {
  configPath: string;
  argv?: string[];
  execPath?: string;
  platform?: ServicePlatformInput;
  environmentPath?: string;
}): ServiceInstallPlan {
  const configPath = resolve(options.configPath);
  const platform = detectServicePlatform(options.platform);
  const commandLine = resolveServiceCommandLine({
    argv: options.argv,
    execPath: options.execPath,
    configPath,
  });

  return {
    platform,
    serviceName: "imp",
    serviceLabel: "dev.imp",
    configPath,
    workingDirectory: dirname(configPath),
    command: commandLine.command,
    args: commandLine.args,
    environmentPath:
      platform === "linux-systemd-user"
        ? options.environmentPath
          ? resolve(options.environmentPath)
          : resolve(dirname(configPath), "service.env")
        : undefined,
  };
}

export function renderServiceDefinition(plan: ServiceInstallPlan): string {
  return getServicePlatformAdapter(plan.platform).renderDefinition(plan);
}

export function detectServicePlatform(
  platform: ServicePlatformInput = process.platform,
): ServicePlatform {
  if (isServicePlatform(platform)) {
    return platform;
  }

  switch (platform) {
    case "linux":
      return "linux-systemd-user";
    case "darwin":
      return "macos-launchd-agent";
    case "win32":
      return "windows-winsw";
    default:
      throw new UnsupportedPlatformError(platform);
  }
}

function isServicePlatform(platform: ServicePlatformInput): platform is ServicePlatform {
  return (
    platform === "linux-systemd-user" ||
    platform === "macos-launchd-agent" ||
    platform === "windows-winsw"
  );
}

function resolveServiceCommandLine(options: {
  configPath: string;
  argv?: string[];
  execPath?: string;
}): { command: string; args: string[] } {
  const argv = options.argv ?? process.argv;
  const execPath = options.execPath ?? process.execPath;
  const entrypoint = argv[1];

  if (!entrypoint) {
    throw new RuntimeStateError("Could not determine the imp CLI entrypoint for service installation.");
  }

  const resolvedEntrypoint = resolve(entrypoint);
  const args = ["start", "--config", options.configPath];
  if (shouldInvokeViaNode(execPath, resolvedEntrypoint)) {
    return {
      command: execPath,
      args: [resolvedEntrypoint, ...args],
    };
  }

  return {
    command: resolvedEntrypoint,
    args,
  };
}

function shouldInvokeViaNode(execPath: string, entrypoint: string): boolean {
  return entrypoint.endsWith(".js") || entrypoint.endsWith(".mjs") || execPath.includes("node");
}
