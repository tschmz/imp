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
        text: "Usage: /logs [lines]",
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
            ? [`Recent logs (${lines.length}):`, ...lines].join("\n")
            : "No log lines are available yet for this endpoint.",
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Log file not found:")) {
        return {
          conversation: message.conversation,
          text: "No log file is available yet for this endpoint.",
        };
      }

      throw error;
    }
  },
};
