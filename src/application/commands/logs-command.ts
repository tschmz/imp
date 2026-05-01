import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { parsePositiveIntegerArgument } from "./utils.js";

export const logsCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "logs",
    description: "Show recent endpoint logs",
    usage: "/logs [lines]",
    helpDescription: "Show recent daemon log lines for this endpoint",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "logs";
  },
  async handle({ message, dependencies, readRecentLogLines }: InboundCommandContext) {
    const requestedLineCount = parsePositiveIntegerArgument(message.commandArgs);
    if (message.commandArgs && requestedLineCount === undefined) {
      return {
        conversation: message.conversation,
        text: ["**Logs**", "Usage: `/logs [lines]`"].join("\n"),
      };
    }

    const lineCount = requestedLineCount ?? 20;
    try {
      const lines = await readRecentLogLines(
        dependencies.runtimeInfo.logFilePath,
        lineCount,
        undefined,
        dependencies.runtimeInfo.endpointId,
      );
      return {
        conversation: message.conversation,
        text:
          lines.length > 0
            ? [
                "**Logs**",
                `Endpoint: \`${dependencies.runtimeInfo.endpointId}\``,
                `Lines: ${lines.length}`,
                "",
                "```jsonl",
                ...lines,
                "```",
              ].join("\n")
            : ["**Logs**", "No log lines are available yet for this endpoint."].join("\n"),
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Log file not found:")) {
        return {
          conversation: message.conversation,
          text: ["**Logs**", "No log file is available yet for this endpoint."].join("\n"),
        };
      }

      throw error;
    }
  },
};
