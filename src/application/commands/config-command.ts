import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

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
    helpDescription: "Show runtime and config details for this bot",
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
        "Runtime config:",
        ...(appConfigSummary.instanceName ? [`Instance: ${appConfigSummary.instanceName}`] : []),
        `Config path: ${dependencies.runtimeInfo.configPath}`,
        `Data root: ${dependencies.runtimeInfo.dataRoot}`,
        `Logging level: ${dependencies.runtimeInfo.loggingLevel}`,
        `Bot: ${dependencies.runtimeInfo.botId}`,
        `Enabled bots: ${dependencies.runtimeInfo.activeBotIds.join(", ")}`,
        `Default agent: ${dependencies.defaultAgentId}`,
      ].join("\n"),
    };
  },
};
