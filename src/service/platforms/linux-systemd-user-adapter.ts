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

export const linuxSystemdUserAdapter: ServicePlatformAdapter = {
  platform: "linux-systemd-user",
  renderDefinition(plan: ServiceInstallPlan): string {
    return [
      "[Unit]",
      "Description=imp daemon",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${plan.workingDirectory}`,
      ...(plan.environmentPath ? [`EnvironmentFile=${plan.environmentPath}`] : []),
      `ExecStart=${[plan.command, ...plan.args].map(quoteSystemdValue).join(" ")}`,
      "Restart=on-failure",
      "RestartSec=3",
      "",
      "[Install]",
      "WantedBy=default.target",
    ].join("\n");
  },
  resolveDefinitionPath(options) {
    const userHome = normalizeHomeDirectory(options.homeDir, homedir());
    return resolve(userHome, ".config", "systemd", "user", `${options.serviceName}.service`);
  },
  async install(options) {
    await options.installer.run("systemctl", ["--user", "daemon-reload"]);
    await options.installer.run("systemctl", ["--user", "enable", "--now", `${options.plan.serviceName}.service`]);
    await options.installer.run("systemctl", ["--user", "restart", `${options.plan.serviceName}.service`]);
  },
  async uninstall(context: ServiceRuntimeContext) {
    await runIgnoringFailure(context.installer, "systemctl", ["--user", "disable", "--now", `${context.serviceName}.service`]);
    await context.installer.run("systemctl", ["--user", "daemon-reload"]);
  },
  async start(context: ServiceRuntimeContext) {
    await context.installer.run("systemctl", ["--user", "start", `${context.serviceName}.service`]);
  },
  async stop(context: ServiceRuntimeContext) {
    await context.installer.run("systemctl", ["--user", "stop", `${context.serviceName}.service`]);
  },
  async restart(context: ServiceRuntimeContext) {
    await context.installer.run("systemctl", ["--user", "restart", `${context.serviceName}.service`]);
  },
  async status(context: ServiceRuntimeContext) {
    if (!context.installer.runAndCapture) {
      throw new Error("Service status inspection is not available with the current installer.");
    }

    const result = await context.installer.runAndCapture("systemctl", [
      "--user",
      "status",
      "--no-pager",
      `${context.serviceName}.service`,
    ]);
    return joinCommandOutput(result.stdout, result.stderr);
  },
};

function quoteSystemdValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
