import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { renderCodeCsv, renderInlineCode } from "./renderers.js";

async function readAppConfigSummary(
  loadAppConfigImpl: InboundCommandContext["loadAppConfig"],
  configPath: string,
): Promise<{ instanceName?: string }> {
  try {
    const appConfig = await loadAppConfigImpl(configPath);
    return {
      instanceName: appConfig.instance.name,
    };
  } catch {
    return {};
  }
}

export const configCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "config",
    description: "Show runtime config",
    helpDescription: "Show runtime config",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "config";
  },
  async handle({ message, dependencies, loadAppConfig }: InboundCommandContext) {
    const appConfigSummary = await readAppConfigSummary(loadAppConfig, dependencies.runtimeInfo.configPath);

    return {
      conversation: message.conversation,
      text: [
        "**Config**",
        ...(appConfigSummary.instanceName ? [`Instance: ${appConfigSummary.instanceName}`] : []),
        `Endpoint: \`${dependencies.runtimeInfo.endpointId}\``,
        `Logging: \`${dependencies.runtimeInfo.loggingLevel}\``,
        `Config: ${renderInlineCode(dependencies.runtimeInfo.configPath)}`,
        `Data: ${renderInlineCode(dependencies.runtimeInfo.dataRoot)}`,
        `Log: ${renderInlineCode(dependencies.runtimeInfo.logFilePath)}`,
        `Endpoints: ${renderCodeCsv(dependencies.runtimeInfo.activeEndpointIds)}`,
      ].join("\n"),
    };
  },
};
