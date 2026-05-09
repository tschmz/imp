import {
  createConversationExport,
  parseConversationExportOptions,
} from "../export/conversation-export.js";
import { renderInlineCode } from "./renderers.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const exportCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "export",
    description: "Export the current session transcript to HTML",
    usage: "/export [readable|full] [html]",
    helpDescription: "Export the current session to HTML",
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
        text: ["**Export**", "Usage: `/export [readable|full] [html]`"].join("\n"),
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
        text: ["**Export**", "No active session to export."].join("\n"),
      };
    }

    const systemPromptSnapshots = options.mode === "full"
      ? await dependencies.conversationStore.listSystemPromptSnapshots?.(conversation) ?? []
      : [];

    const result = await createConversationExport({
      conversation,
      dataRoot: dependencies.runtimeInfo.dataRoot,
      mode: options.mode,
      format: options.format,
      now: message.receivedAt,
      systemPromptSnapshots,
    });

    return {
      conversation: message.conversation,
      text: [
        "**Export**",
        `Path: ${renderInlineCode(result.path)}`,
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
