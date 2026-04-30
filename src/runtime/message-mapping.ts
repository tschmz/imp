import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  Api as AiApi,
  AssistantMessage,
  ImageContent,
  TextContent,
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
const TELEGRAM_IMAGE_CONTEXT =
  "Telegram image uploaded. The image has been downloaded and saved locally for this conversation.";

export async function toAgentMessages(
  messages: ConversationEvent[],
  model: Model<AiApi>,
  dependencies: {
    readBinaryFile?: (path: string) => Promise<Uint8Array>;
  } = {},
): Promise<Array<UserMessage | AssistantMessage | ToolResultMessage>> {
  const readBinaryFile = dependencies.readBinaryFile ?? defaultReadBinaryFile;

  return Promise.all(messages.map(async (message): Promise<UserMessage | AssistantMessage | ToolResultMessage> => {
    if (message.role === "user") {
      return {
        role: "user",
        content: await renderUserMessageContent(message, model, readBinaryFile),
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
  }));
}

export function toConversationEvents(
  messages: AgentMessage[],
  options: {
    parentMessageId: string;
    correlationId: string;
    initialAssistantIndex?: number;
    initialToolResultIndex?: number;
  },
): ConversationEvent[] {
  let assistantIndex = options.initialAssistantIndex ?? 0;
  let toolResultIndex = options.initialToolResultIndex ?? 0;

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
      id: `${options.parentMessageId}:assistant:${assistantIndex}`,
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

async function renderUserMessageContent(
  message: ConversationUserMessage,
  model: Model<AiApi>,
  readBinaryFile: (path: string) => Promise<Uint8Array>,
): Promise<UserMessage["content"]> {
  if (message.source?.kind === "telegram-image") {
    return renderImageMessageContent(message.content, message.source, model, readBinaryFile);
  }

  if (message.source?.kind === "telegram-document") {
    return renderTextWithSourceContext(message.content, message.source);
  }

  if (message.source?.kind !== "telegram-voice-transcript") {
    return message.content;
  }

  return renderTextWithSourceContext(message.content, message.source);
}

async function renderImageMessageContent(
  content: UserMessage["content"],
  source: IncomingMessageSource,
  model: Model<AiApi>,
  readBinaryFile: (path: string) => Promise<Uint8Array>,
): Promise<UserMessage["content"]> {
  const imageContent = await tryReadTelegramImage(source, model, readBinaryFile);
  const textContent = renderTextWithSourceContext(content, source);
  if (!imageContent) {
    return textContent;
  }

  if (typeof textContent === "string") {
    return [{ type: "text", text: textContent }, imageContent];
  }

  return [...textContent, imageContent];
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

export async function renderIncomingMessageForAgent(
  message: IncomingMessage,
  model: Model<AiApi>,
  dependencies: {
    readBinaryFile?: (path: string) => Promise<Uint8Array>;
  } = {},
): Promise<{ text: string; images?: ImageContent[] }> {
  const text = renderIncomingMessageTextForAgent(message);
  const readBinaryFile = dependencies.readBinaryFile ?? defaultReadBinaryFile;
  const image = await tryReadTelegramImage(message.source, model, readBinaryFile);

  return image ? { text, images: [image] } : { text };
}

function renderSourceContext(source: IncomingMessageSource): string {
  if (source.kind === "telegram-voice-transcript") {
    return TRANSCRIBED_MESSAGE_PREFIX;
  }

  if (source.kind === "telegram-document" && source.document) {
    const lines = [
      TELEGRAM_DOCUMENT_CONTEXT,
      ...(source.document.savedPath ? [`Saved path: ${source.document.savedPath}`] : []),
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

  if (source.kind === "telegram-image" && source.image) {
    const lines = [
      TELEGRAM_IMAGE_CONTEXT,
      ...(source.image.savedPath ? [`Saved path: ${source.image.savedPath}`] : []),
      ...(source.image.fileName ? [`File name: ${source.image.fileName}`] : []),
      ...(source.image.mimeType ? [`MIME type: ${source.image.mimeType}`] : []),
      ...(typeof source.image.sizeBytes === "number"
        ? [`Size: ${source.image.sizeBytes} bytes`]
        : []),
      ...(typeof source.image.width === "number" && typeof source.image.height === "number"
        ? [`Dimensions: ${source.image.width}x${source.image.height}`]
        : []),
      ...(source.image.telegramType ? [`Telegram image type: ${source.image.telegramType}`] : []),
      `Telegram file id: ${source.image.fileId}`,
      ...(source.image.fileUniqueId ? [`Telegram unique file id: ${source.image.fileUniqueId}`] : []),
    ];

    return `[${lines.join("\n")}]\n`;
  }

  return "";
}

async function tryReadTelegramImage(
  source: IncomingMessageSource | undefined,
  model: Model<AiApi>,
  readBinaryFile: (path: string) => Promise<Uint8Array>,
): Promise<ImageContent | undefined> {
  if (source?.kind !== "telegram-image" || !source.image?.savedPath || !source.image.mimeType) {
    return undefined;
  }

  if (!modelSupportsImages(model)) {
    return undefined;
  }

  try {
    const bytes = await readBinaryFile(source.image.savedPath);
    return {
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: source.image.mimeType,
    };
  } catch {
    return undefined;
  }
}

function modelSupportsImages(model: Model<AiApi>): boolean {
  return Array.isArray(model.input) && model.input.includes("image");
}

async function defaultReadBinaryFile(path: string): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(path));
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

export function getAssistantCommentaryText(
  message: Pick<AssistantMessage, "content"> | Pick<ConversationAssistantMessage, "content">,
): string {
  return getAssistantTextByPhase(message, "commentary");
}

export function getAssistantText(message: AssistantMessage): string {
  const finalAnswerText = getAssistantTextByPhase(message, "final_answer");
  if (finalAnswerText) {
    return finalAnswerText;
  }

  return message.content
    .filter((content): content is TextContent => (
      content.type === "text" && parseTextSignature(content.textSignature)?.phase !== "commentary"
    ))
    .map((content) => content.text)
    .join("\n");
}

function getAssistantTextByPhase(
  message: Pick<AssistantMessage, "content"> | Pick<ConversationAssistantMessage, "content">,
  phase: "commentary" | "final_answer",
): string {
  return message.content
    .filter((content): content is TextContent => (
      content.type === "text" && parseTextSignature(content.textSignature)?.phase === phase
    ))
    .map((content) => content.text)
    .join("\n");
}

function parseTextSignature(
  signature: string | undefined,
): { id: string; phase?: "commentary" | "final_answer" } | undefined {
  if (!signature) {
    return undefined;
  }

  if (!signature.startsWith("{")) {
    return { id: signature };
  }

  try {
    const parsed = JSON.parse(signature) as { v?: unknown; id?: unknown; phase?: unknown };
    if (parsed.v !== 1 || typeof parsed.id !== "string") {
      return undefined;
    }

    return {
      id: parsed.id,
      ...(parsed.phase === "commentary" || parsed.phase === "final_answer"
        ? { phase: parsed.phase }
        : {}),
    };
  } catch {
    return undefined;
  }
}
