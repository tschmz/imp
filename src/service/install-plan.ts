import { dirname, resolve } from "node:path";

export type ServicePlatform = "linux-systemd-user" | "macos-launchd-agent" | "windows-winsw";

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
  platform?: NodeJS.Platform;
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
      platform === "linux-systemd-user" ? resolve(options.environmentPath ?? `${configPath}.service.env`) : undefined,
  };
}

export function renderServiceDefinition(plan: ServiceInstallPlan): string {
  switch (plan.platform) {
    case "linux-systemd-user":
      return renderSystemdUserUnit(plan);
    case "macos-launchd-agent":
      return renderLaunchdPlist(plan);
    case "windows-winsw":
      return renderWinSwConfig(plan);
  }
}

export function detectServicePlatform(
  platform: NodeJS.Platform = process.platform,
): ServicePlatform {
  switch (platform) {
    case "linux":
      return "linux-systemd-user";
    case "darwin":
      return "macos-launchd-agent";
    case "win32":
      return "windows-winsw";
    default:
      throw new Error(`Service installation is not supported on platform: ${platform}`);
  }
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
    throw new Error("Could not determine the imp CLI entrypoint for service installation.");
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

function renderSystemdUserUnit(plan: ServiceInstallPlan): string {
  return [
    "[Unit]",
    "Description=imp daemon",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${plan.workingDirectory}`,
    ...(plan.environmentPath ? [`EnvironmentFile=${quoteSystemdValue(plan.environmentPath)}`] : []),
    `ExecStart=${[plan.command, ...plan.args].map(quoteSystemdValue).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=default.target",
  ].join("\n");
}

function renderLaunchdPlist(plan: ServiceInstallPlan): string {
  const programArguments = [plan.command, ...plan.args]
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${escapeXml(plan.serviceLabel)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    programArguments,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(plan.workingDirectory)}</string>`,
    "</dict>",
    "</plist>",
  ].join("\n");
}

function renderWinSwConfig(plan: ServiceInstallPlan): string {
  return [
    "<service>",
    `  <id>${escapeXml(plan.serviceName)}</id>`,
    `  <name>${escapeXml(plan.serviceName)}</name>`,
    "  <description>imp daemon</description>",
    `  <executable>${escapeXml(plan.command)}</executable>`,
    `  <arguments>${escapeXml(plan.args.join(" "))}</arguments>`,
    `  <workingdirectory>${escapeXml(plan.workingDirectory)}</workingdirectory>`,
    "  <onfailure action=\"restart\" delay=\"5 sec\" />",
    "</service>",
  ].join("\n");
}

function quoteSystemdValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
