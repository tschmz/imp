import type { ServiceInstallPlan } from "../install-plan.js";
import { ServiceOperationError } from "../service-error.js";
import type { ServicePlatformAdapter } from "./service-platform-adapter.js";

export const windowsWinSwAdapter: ServicePlatformAdapter = {
  platform: "windows-winsw",
  renderDefinition(plan: ServiceInstallPlan): string {
    return [
      "<service>",
      `  <id>${escapeXml(plan.serviceName)}</id>`,
      `  <name>${escapeXml(plan.serviceName)}</name>`,
      `  <description>${escapeXml(plan.description)}</description>`,
      `  <executable>${escapeXml(plan.command)}</executable>`,
      `  <arguments>${escapeXml(plan.args.join(" "))}</arguments>`,
      `  <workingdirectory>${escapeXml(plan.workingDirectory)}</workingdirectory>`,
      "  <onfailure action=\"restart\" delay=\"5 sec\" />",
      "</service>",
    ].join("\n");
  },
  resolveDefinitionPath() {
    throw new ServiceOperationError("unsupported", "Automatic Windows service installation is not implemented yet.");
  },
  async install() {
    throw new ServiceOperationError("unsupported", "Automatic Windows service installation is not implemented yet.");
  },
  async uninstall() {
    throw new ServiceOperationError("unsupported", "Automatic Windows service uninstallation is not implemented yet.");
  },
  async start() {
    throw new ServiceOperationError("unsupported", "Automatic Windows service control is not implemented yet.");
  },
  async stop() {
    throw new ServiceOperationError("unsupported", "Automatic Windows service control is not implemented yet.");
  },
  async restart() {
    throw new ServiceOperationError("unsupported", "Automatic Windows service control is not implemented yet.");
  },
  async status() {
    throw new ServiceOperationError("unsupported", "Automatic Windows service status is not implemented yet.");
  },
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
