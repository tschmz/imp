import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  Api as AiApi,
  AssistantMessage,
  Model,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type {
  ConversationAssistantMessage,
  ConversationEvent,
  ConversationUserMessage,
} from "../domain/conversation.js";
import type { IncomingMessage, IncomingMessageSource } from "../domain/message.js";

const TRANSCRIBED_MESSAGE_PREFIX =
  "[Transcribed from a Telegram voice message. Automatic speech recognition may contain mistakes. If the request seems unclear or inconsistent with the conversation, ask a brief clarifying question before acting on uncertain details.]\n";

const TELEGRAM_DOCUMENT_CONTEXT =
  "Telegram document uploaded. The file has been downloaded and saved locally for this conversation.";

export function toAgentMessages(
  messages: ConversationEvent[],
  model: Model<AiApi>,
): Array<UserMessage | AssistantMessage | ToolResultMessage> {
  return messages.map<UserMessage | AssistantMessage | ToolResultMessage>((message) => {
    if (message.role === "user") {
      return {
        role: "user",
        content: renderUserMessageContent(message),
        timestamp: resolveMessageTimestamp(message),
      };
    }

    if (message.role === "toolResult") {
      return {
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        ...(message.details !== undefined ? { details: message.details } : {}),
        isError: message.isError ?? false,
        timestamp: resolveMessageTimestamp(message),
      };
    }

    return {
      role: "assistant",
      content: message.content,
      api: message.api ?? model.api,
      provider: message.provider ?? model.provider,
      model: message.model ?? model.id,
      ...(message.responseId ? { responseId: message.responseId } : {}),
      usage: message.usage,
      stopReason: message.stopReason,
      ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
      timestamp: resolveMessageTimestamp(message),
    };
  });
}

export function toConversationEvents(
  messages: AgentMessage[],
  options: {
    parentMessageId: string;
    correlationId: string;
  },
): ConversationEvent[] {
  let assistantIndex = 0;
  let toolResultIndex = 0;

  return messages.flatMap<ConversationEvent>((message) => {
    if (message.role === "user") {
      return [];
    }

    if (message.role === "toolResult") {
      toolResultIndex += 1;
      return {
        kind: "message",
        id: `${options.parentMessageId}:tool-result:${toolResultIndex}`,
        role: "toolResult",
        createdAt: new Date(message.timestamp).toISOString(),
        correlationId: options.correlationId,
        timestamp: message.timestamp,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        ...(message.details !== undefined ? { details: message.details } : {}),
        isError: message.isError,
      };
    }

    if (message.role !== "assistant") {
      return [];
    }

    assistantIndex += 1;
    return {
      kind: "message",
      id:
        assistantIndex === 1 && messages.filter((candidate) => candidate.role === "assistant").length === 1
          ? `${options.parentMessageId}:assistant`
          : `${options.parentMessageId}:assistant:${assistantIndex}`,
      role: "assistant",
      createdAt: new Date(message.timestamp).toISOString(),
      correlationId: options.correlationId,
      timestamp: message.timestamp,
      content: message.content,
      api: message.api,
      provider: message.provider,
      model: message.model,
      ...(message.responseId ? { responseId: message.responseId } : {}),
      usage: message.usage,
      stopReason: message.stopReason,
      ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
    };
  });
}

function renderUserMessageContent(
  message: ConversationUserMessage,
): UserMessage["content"] {
  if (message.source?.kind === "telegram-document") {
    return renderTextWithSourceContext(message.content, message.source);
  }

  if (message.source?.kind !== "telegram-voice-transcript") {
    return message.content;
  }

  return renderTextWithSourceContext(message.content, message.source);
}

function renderTextWithSourceContext(
  content: UserMessage["content"],
  source: IncomingMessageSource,
): UserMessage["content"] {
  if (typeof content === "string") {
    return `${renderSourceContext(source)}${content}`;
  }

  return [
    { type: "text", text: renderSourceContext(source).trimEnd() },
    ...content,
  ];
}

export function renderIncomingMessageTextForAgent(message: IncomingMessage): string {
  if (!message.source || message.source.kind === "text") {
    return message.text;
  }

  return `${renderSourceContext(message.source)}${message.text}`;
}

function renderSourceContext(source: IncomingMessageSource): string {
  if (source.kind === "telegram-voice-transcript") {
    return TRANSCRIBED_MESSAGE_PREFIX;
  }

  if (source.kind === "telegram-document" && source.document) {
    const lines = [
      TELEGRAM_DOCUMENT_CONTEXT,
      ...(source.document.savedPath ? [`Saved path: ${source.document.savedPath}`] : []),
      ...(source.document.relativePath ? [`Relative path: ${source.document.relativePath}`] : []),
      ...(source.document.fileName ? [`File name: ${source.document.fileName}`] : []),
      ...(source.document.mimeType ? [`MIME type: ${source.document.mimeType}`] : []),
      ...(typeof source.document.sizeBytes === "number"
        ? [`Size: ${source.document.sizeBytes} bytes`]
        : []),
      `Telegram file id: ${source.document.fileId}`,
      ...(source.document.fileUniqueId ? [`Telegram unique file id: ${source.document.fileUniqueId}`] : []),
    ];

    return `[${lines.join("\n")}]\n`;
  }

  return "";
}

function resolveMessageTimestamp(
  message: Pick<ConversationEvent, "createdAt"> & Partial<Pick<ConversationAssistantMessage, "timestamp">>,
): number {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return message.timestamp;
  }

  const parsed = Date.parse(message.createdAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}
