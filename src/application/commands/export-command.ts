import {
  createConversationExport,
  parseConversationExportOptions,
} from "../export/conversation-export.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const exportCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "export",
    description: "Export the current session transcript to HTML",
    usage: "/export [readable|full] [html]",
    helpDescription: "Export the current session transcript to an HTML file. Defaults to readable mode",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "export";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const options = parseConversationExportOptions(message.commandArgs);
    if (!options) {
      return {
        conversation: message.conversation,
        text: "Usage: /export [readable|full] [html]",
      };
    }

    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const conversation =
      await dependencies.conversationStore.getActiveForAgent?.(agentId) ??
      await dependencies.conversationStore.get(message.conversation);
    if (!conversation) {
      return {
        conversation: message.conversation,
        text: "There is no active session to export.",
      };
    }

    const result = await createConversationExport({
      conversation,
      dataRoot: dependencies.runtimeInfo.dataRoot,
      mode: options.mode,
      format: options.format,
      now: message.receivedAt,
    });

    return {
      conversation: message.conversation,
      text: [
        "Export created.",
        `Mode: ${result.mode}`,
        `Format: ${result.format.toUpperCase()}`,
        `Path: ${result.path}`,
        `Link: ${result.fileUrl}`,
      ].join("\n"),
      attachments: [
        {
          kind: "file",
          path: result.path,
          fileName: `conversation-${result.mode}.${result.format}`,
          mimeType: "text/html",
        },
      ],
    };
  },
};
