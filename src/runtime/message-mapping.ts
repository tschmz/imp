import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  Api as AiApi,
  AssistantMessage,
  Model,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type {
  ConversationEvent,
  ConversationMessage,
  ConversationToolResultContent,
} from "../domain/conversation.js";

const TRANSCRIBED_MESSAGE_PREFIX =
  "[Transcribed from a Telegram voice message. Automatic speech recognition may contain mistakes. If the request seems unclear or inconsistent with the conversation, ask a brief clarifying question before acting on uncertain details.]\n";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export function toAgentMessages(
  messages: ConversationEvent[],
  model: Model<AiApi>,
): Array<UserMessage | AssistantMessage | ToolResultMessage> {
  return messages.reduce<Array<UserMessage | AssistantMessage | ToolResultMessage>>(
    (result, message) => {
      if (message.kind === "tool-call") {
        result.push({
          role: "assistant",
          content: [
            ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
            ...message.toolCalls.map((toolCall) => ({
              type: "toolCall" as const,
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            })),
          ],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: EMPTY_USAGE,
          stopReason: "toolUse",
          timestamp: Date.parse(message.createdAt),
        });
        return result;
      }

      if (message.kind === "tool-result") {
        result.push({
          role: "toolResult",
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          content: message.content,
          ...(message.details !== undefined ? { details: message.details } : {}),
          isError: message.isError,
          timestamp: Date.parse(message.createdAt),
        });
        return result;
      }

      if (message.role === "user") {
        result.push({
          role: "user",
          content: renderUserMessageContent(message),
          timestamp: Date.parse(message.createdAt),
        });
        return result;
      }

      if (message.role === "assistant") {
        result.push({
          role: "assistant",
          content: [{ type: "text", text: message.text }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: EMPTY_USAGE,
          stopReason: "stop",
          timestamp: Date.parse(message.createdAt),
        });
      }

      return result;
    },
    [],
  );
}

export function toConversationEvents(
  messages: AgentMessage[],
  options: {
    parentMessageId: string;
    correlationId: string;
  },
): ConversationEvent[] {
  let toolCallIndex = 0;
  let toolResultIndex = 0;

  return messages.flatMap<ConversationEvent>((message) => {
    if (message.role === "user") {
      return [];
    }

    if (message.role === "toolResult") {
      toolResultIndex += 1;
      return {
        kind: "tool-result",
        id: `${options.parentMessageId}:tool-result:${toolResultIndex}`,
        createdAt: new Date(message.timestamp).toISOString(),
        correlationId: options.correlationId,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content.map((content) => toConversationToolResultContent(content)),
        ...(message.details !== undefined ? { details: message.details } : {}),
        isError: message.isError,
      };
    }

    if (message.role !== "assistant") {
      return [];
    }

    const text = getAssistantText(message);
    const toolCalls = message.content
      .filter((content): content is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => content.type === "toolCall")
      .map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }));

    if (toolCalls.length > 0) {
      toolCallIndex += 1;
      return {
        kind: "tool-call",
        id: `${options.parentMessageId}:tool-call:${toolCallIndex}`,
        createdAt: new Date(message.timestamp).toISOString(),
        correlationId: options.correlationId,
        ...(text ? { text } : {}),
        toolCalls,
      };
    }

    return {
      kind: "message",
      id: `${options.parentMessageId}:assistant`,
      role: "assistant",
      text,
      createdAt: new Date(message.timestamp).toISOString(),
      correlationId: options.correlationId,
    };
  });
}

function toConversationToolResultContent(
  content: ToolResultMessage["content"][number],
): ConversationToolResultContent {
  if (content.type === "image") {
    return {
      type: "image",
      data: content.data,
      mimeType: content.mimeType,
    };
  }

  return {
    type: "text",
    text: content.text,
  };
}

function renderUserMessageContent(message: ConversationMessage): string {
  if (message.source?.kind === "telegram-voice-transcript") {
    return `${TRANSCRIBED_MESSAGE_PREFIX}${message.text}`;
  }

  return message.text;
}

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}
