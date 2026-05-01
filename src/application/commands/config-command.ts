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
    helpDescription: "Show runtime and config details for this endpoint",
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
        `Default agent: \`${dependencies.defaultAgentId}\``,
        `Logging: \`${dependencies.runtimeInfo.loggingLevel}\``,
        `Config: ${renderInlineCode(dependencies.runtimeInfo.configPath)}`,
        `Data: ${renderInlineCode(dependencies.runtimeInfo.dataRoot)}`,
        `Log file: ${renderInlineCode(dependencies.runtimeInfo.logFilePath)}`,
        `Enabled endpoints: ${renderCodeCsv(dependencies.runtimeInfo.activeEndpointIds)}`,
      ].join("\n"),
    };
  },
};
