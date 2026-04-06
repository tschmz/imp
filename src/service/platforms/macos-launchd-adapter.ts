import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ServiceInstallPlan } from "../install-plan.js";
import {
  joinCommandOutput,
  normalizeHomeDirectory,
  runIgnoringFailure,
  type ServicePlatformAdapter,
  type ServiceRuntimeContext,
} from "./service-platform-adapter.js";

export const macosLaunchdAdapter: ServicePlatformAdapter = {
  platform: "macos-launchd-agent",
  renderDefinition(plan: ServiceInstallPlan): string {
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
  },
  resolveDefinitionPath(options) {
    const userHome = normalizeHomeDirectory(options.homeDir, homedir());
    return resolve(userHome, "Library", "LaunchAgents", `${options.serviceLabel}.plist`);
  },
  async install(options) {
    const domainTarget = getLaunchdDomainTarget(options.uid);
    await runIgnoringFailure(options.installer, "launchctl", ["bootout", domainTarget, options.definitionPath]);
    await options.installer.run("launchctl", ["bootstrap", domainTarget, options.definitionPath]);
    await options.installer.run("launchctl", ["kickstart", "-k", `${domainTarget}/${options.plan.serviceLabel}`]);
    return {
      operation: "install",
      platform: "macos-launchd-agent",
      serviceName: options.plan.serviceName,
      definitionPath: options.definitionPath,
    };
  },
  async uninstall(context: ServiceRuntimeContext) {
    const domainTarget = getLaunchdDomainTarget(context.uid);
    await runIgnoringFailure(context.installer, "launchctl", ["bootout", domainTarget, context.definitionPath]);
    return {
      operation: "uninstall",
      platform: "macos-launchd-agent",
      serviceName: context.serviceName,
      definitionPath: context.definitionPath,
    };
  },
  async start(context: ServiceRuntimeContext) {
    const domainTarget = getLaunchdDomainTarget(context.uid);
    await runIgnoringFailure(context.installer, "launchctl", ["bootstrap", domainTarget, context.definitionPath]);
    await runIgnoringFailure(context.installer, "launchctl", ["kickstart", "-k", `${domainTarget}/${context.serviceLabel}`]);
    return {
      operation: "start",
      platform: "macos-launchd-agent",
      serviceName: context.serviceName,
      definitionPath: context.definitionPath,
    };
  },
  async stop(context: ServiceRuntimeContext) {
    const domainTarget = getLaunchdDomainTarget(context.uid);
    await context.installer.run("launchctl", ["bootout", domainTarget, context.definitionPath]);
    return {
      operation: "stop",
      platform: "macos-launchd-agent",
      serviceName: context.serviceName,
      definitionPath: context.definitionPath,
    };
  },
  async restart(context: ServiceRuntimeContext) {
    const domainTarget = getLaunchdDomainTarget(context.uid);
    await runIgnoringFailure(context.installer, "launchctl", ["bootout", domainTarget, context.definitionPath]);
    await context.installer.run("launchctl", ["bootstrap", domainTarget, context.definitionPath]);
    await runIgnoringFailure(context.installer, "launchctl", ["kickstart", "-k", `${domainTarget}/${context.serviceLabel}`]);
    return {
      operation: "restart",
      platform: "macos-launchd-agent",
      serviceName: context.serviceName,
      definitionPath: context.definitionPath,
    };
  },
  async status(context: ServiceRuntimeContext) {
    if (!context.installer.runAndCapture) {
      throw new Error("Service status inspection is not available with the current installer.");
    }

    const result = await context.installer.runAndCapture("launchctl", [
      "print",
      `${getLaunchdDomainTarget(context.uid)}/${context.serviceLabel}`,
    ]);
    return {
      operation: "status",
      platform: "macos-launchd-agent",
      serviceName: context.serviceName,
      definitionPath: context.definitionPath,
      statusOutput: joinCommandOutput(result.stdout, result.stderr),
    };
  },
};

function getLaunchdDomainTarget(uid: number | undefined): string {
  const resolvedUid = uid ?? process.getuid?.();
  if (resolvedUid === undefined) {
    throw new Error("Could not determine the current user ID for launchd service control.");
  }

  return `gui/${resolvedUid}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
