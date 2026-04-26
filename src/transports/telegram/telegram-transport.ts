import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";
import { Bot, GrammyError, InputFile } from "grammy";
import { parseInboundCommand } from "../../application/commands/parse-inbound-command.js";
import { inboundCommandMenu, inboundCommandNames } from "../../application/commands/registry.js";
import { renderUserFacingError } from "../../application/render-user-facing-error.js";
import type { TelegramEndpointRuntimeConfig } from "../../daemon/types.js";
import type {
  IncomingMessage,
  IncomingMessageCommand,
  OutgoingMessage,
  OutgoingMessageReplayItem,
} from "../../domain/message.js";
import { UserVisibleProcessingError } from "../../domain/processing-error.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportContext, TransportHandler, TransportInboundEvent } from "../types.js";
import {
  createOpenAiVoiceTranscriber,
  type VoiceTranscriber,
} from "./openai-voice-transcriber.js";
import { renderTelegramMessages } from "./render-telegram-message.js";

const defaultTelegramDocumentMaxDownloadBytes = 20 * 1024 * 1024;

type TelegramTransportRuntimeConfig = TelegramEndpointRuntimeConfig & {
  paths?: {
    conversationsDir?: string;
  };
};

interface TelegramBotAdapter {
  api: {
    getMe(): Promise<TelegramBotProfile>;
    getFile(fileId: string): Promise<TelegramFile>;
    sendMessage(chatId: number | string, text: string, other?: { parse_mode?: "HTML" | "MarkdownV2" }): Promise<unknown>;
    sendDocument(
      chatId: number | string,
      document: InputFile,
      other?: { caption?: string },
    ): Promise<unknown>;
    sendChatAction(chatId: number, action: "typing"): Promise<unknown>;
    setMyCommands(commands: ReadonlyArray<{ command: string; description: string }>): Promise<unknown>;
  };
  on(filter: "message" | "message:text", handler: (ctx: TelegramMessageContext) => Promise<void>): void;
  start(): Promise<void>;
  stop(): void;
}

interface TelegramBotProfile {
  username?: string;
}

interface TelegramFile {
  file_path?: string;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TelegramMessage {
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
  message_id: number;
  text?: string;
  voice?: {
    file_id: string;
    mime_type?: string;
  };
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  caption?: string;
}

interface TelegramMessageContext {
  chat?: {
    id: number;
    type: string;
  };
  message?: TelegramMessage;
  from?: {
    id: number;
  };
  reply(
    text: string,
    other?: {
      parse_mode?: "HTML" | "MarkdownV2";
    },
  ): Promise<unknown>;
}

interface TelegramTransportDependencies {
  fetch?: typeof fetch;
  voiceTranscriber?: VoiceTranscriber;
}

export function createTelegramTransport(
  config: TelegramTransportRuntimeConfig,
  bot: TelegramBotAdapter = new Bot(config.token),
  logger?: Logger,
  dependencies: TelegramTransportDependencies = {},
  context?: TransportContext,
): Transport {
  const allowedUserIds = new Set(config.allowedUserIds);
  const fetchImpl = dependencies.fetch ?? fetch;
  const voiceTranscriber =
    dependencies.voiceTranscriber ??
    (config.voice?.enabled ? createOpenAiVoiceTranscriber() : undefined);
  let registeredDeliveryCleanup: (() => void) | undefined;

  return {
    async start(handler: TransportHandler): Promise<void> {
      registeredDeliveryCleanup = context?.deliveryRouter.register(config.id, {
        async deliver(request): Promise<void> {
          for (const chunk of renderTelegramMessages(request.message.text)) {
            await bot.api.sendMessage(request.target.conversationId, chunk, {
              parse_mode: "HTML",
            });
          }
          await sendTelegramAttachments(bot, request.target.conversationId, request.message);
          await sendTelegramReplay(bot, request.target.conversationId, request.message);
        },
      });

      const profile = await getTelegramBotProfile(bot, config);
      await logger?.debug("validated telegram bot token", {
        endpointId: config.id,
        transport: "telegram",
      });

      await registerTelegramCommands(bot, config);
      await logger?.debug("registered telegram bot commands", {
        endpointId: config.id,
        transport: "telegram",
      });

      bot.on("message:text", async (ctx) => {
        const safeContext = validateTelegramContext(ctx, config.id, allowedUserIds, logger);
        if (!safeContext) {
          return;
        }

        const textMessage = getTelegramTextMessage(safeContext.message);
        if (!textMessage) {
          return;
        }

        const text = textMessage.text.trim();
        if (!text) {
          await logger?.debug("ignored empty telegram message", {
            endpointId: config.id,
            transport: "telegram",
            conversationId: String(safeContext.chat.id),
            messageId: String(textMessage.message_id),
          });
          return;
        }

        dispatchTelegramEvent(
          handler,
          createTelegramInboundEvent(
            config.id,
            randomUUID(),
            safeContext,
            bot,
            {
              text,
              source: {
                kind: "text",
              },
              options: parseTelegramCommand(textMessage, profile.username),
            },
            logger,
          ),
          logger,
        );
      });

      bot.on("message", async (ctx) => {
        const safeContext = validateTelegramContext(ctx, config.id, allowedUserIds, logger);
        if (!safeContext) {
          return;
        }

        const voiceMessage = getTelegramVoiceMessage(safeContext.message);
        if (voiceMessage) {
          const correlationId = randomUUID();
          const messageId = String(voiceMessage.message_id);
          const conversationId = String(safeContext.chat.id);

          if (!config.voice?.enabled || !voiceTranscriber) {
            await logger?.debug("ignored telegram voice message because voice transcription is disabled", {
              endpointId: config.id,
              transport: "telegram",
              conversationId,
              messageId,
              correlationId,
            });
            await safeContext.reply("Voice messages are not enabled for this endpoint.");
            return;
          }

          try {
            const transcript = await transcribeTelegramVoiceMessage(
              voiceMessage,
              config,
              bot,
              voiceTranscriber,
              fetchImpl,
            );
            if (!transcript) {
              throw new Error("Voice transcription returned empty text.");
            }

            await logger?.debug("transcribed telegram voice message", {
              endpointId: config.id,
              transport: "telegram",
              conversationId,
              messageId,
              correlationId,
            });

            dispatchTelegramEvent(
              handler,
              createTelegramInboundEvent(
                config.id,
                correlationId,
                safeContext,
                bot,
                {
                  text: transcript,
                  transcript,
                  source: {
                    kind: "telegram-voice-transcript",
                    transcript: {
                      provider: config.voice.transcription.provider,
                      model: config.voice.transcription.model,
                    },
                  },
                },
                logger,
              ),
              logger,
            );
          } catch (error) {
            await logger?.error(
              "failed to transcribe telegram voice message",
              {
                endpointId: config.id,
                transport: "telegram",
                conversationId,
                messageId,
                correlationId,
                errorType: error instanceof Error ? error.name : typeof error,
              },
              error,
            );
            await safeContext.reply("Sorry, I couldn't transcribe that voice message.");
          }
          return;
        }

        const documentMessage = getTelegramDocumentMessage(safeContext.message);
        const photoMessage = getTelegramPhotoMessage(safeContext.message);
        if (photoMessage) {
          const correlationId = randomUUID();
          const messageId = String(photoMessage.message_id);
          const conversationId = String(safeContext.chat.id);
          const photo = getLargestTelegramPhoto(photoMessage);
          if (!photo) {
            return;
          }
          const sizeBytes = photo?.file_size;

          const maxDownloadBytes = getTelegramDocumentMaxDownloadBytes(config);
          if (typeof sizeBytes === "number" && sizeBytes > maxDownloadBytes) {
            await logger?.error("telegram image exceeds configured download size limit", {
              endpointId: config.id,
              transport: "telegram",
              conversationId,
              messageId,
              correlationId,
            });
            await safeContext.reply(
              `Sorry, that image is too large. The current limit is ${maxDownloadBytes} bytes.`,
            );
            return;
          }

          dispatchTelegramEvent(
            handler,
            createTelegramInboundEvent(
              config.id,
              correlationId,
              safeContext,
              bot,
              {
                text: getTelegramPhotoUserText(photoMessage),
                image: {
                  kind: "photo",
                  photo,
                },
                config,
                fetchImpl,
              },
              logger,
            ),
            logger,
          );
          return;
        }

        if (!documentMessage) {
          return;
        }

        const correlationId = randomUUID();
        const messageId = String(documentMessage.message_id);
        const conversationId = String(safeContext.chat.id);
        const sizeBytes = documentMessage.document.file_size;
        const isImageDocument = isTelegramImageDocument(documentMessage.document);

        const maxDownloadBytes = getTelegramDocumentMaxDownloadBytes(config);
        if (typeof sizeBytes === "number" && sizeBytes > maxDownloadBytes) {
          await logger?.error(
            isImageDocument
              ? "telegram image exceeds configured download size limit"
              : "telegram document exceeds configured download size limit",
            {
            endpointId: config.id,
            transport: "telegram",
            conversationId,
            messageId,
            correlationId,
            },
          );
          await safeContext.reply(
            `Sorry, that ${isImageDocument ? "image" : "document"} is too large. The current limit is ${maxDownloadBytes} bytes.`,
          );
          return;
        }

        dispatchTelegramEvent(
          handler,
          createTelegramInboundEvent(
            config.id,
            correlationId,
            safeContext,
            bot,
            {
              text: getTelegramDocumentUserText(documentMessage),
              ...(isImageDocument
                ? {
                    image: {
                      kind: "document" as const,
                      document: documentMessage.document,
                    },
                  }
                : {
                    document: documentMessage.document,
                  }),
              config,
              fetchImpl,
            },
            logger,
          ),
          logger,
        );
      });

      await bot.start();
    },
    async stop(): Promise<void> {
      registeredDeliveryCleanup?.();
      registeredDeliveryCleanup = undefined;
      bot.stop();
    },
  };
}

function dispatchTelegramEvent(
  handler: TransportHandler,
  event: TransportInboundEvent,
  logger: Logger | undefined,
): void {
  const startedAt = Date.now();
  const conversationId = event.message.conversation.externalId;
  const messageId = event.message.messageId;
  const correlationId = event.message.correlationId;

  void logger?.debug("received telegram message", {
    endpointId: event.message.endpointId,
    transport: "telegram",
    conversationId,
    messageId,
    correlationId,
  });

  detachTelegramEventProcessing(
    processTelegramEvent(handler, event, {
      logger,
      endpointId: event.message.endpointId,
      conversationId,
      messageId,
      correlationId,
      startedAt,
    }),
    {
      logger,
      endpointId: event.message.endpointId,
      conversationId,
      messageId,
      correlationId,
    },
  );
}

function validateTelegramContext(
  ctx: TelegramMessageContext,
  endpointId: string,
  allowedUserIds: Set<string>,
  logger?: Logger,
): Required<Pick<TelegramMessageContext, "chat" | "message" | "from" | "reply">> | undefined {
  if (!ctx.chat || !ctx.message || !ctx.from) {
    void logger?.debug("ignored telegram update without chat, message, or sender", {
      endpointId,
      transport: "telegram",
    });
    return undefined;
  }

  if (ctx.chat.type !== "private") {
    void logger?.debug("ignored non-private telegram chat", {
      endpointId,
      transport: "telegram",
      conversationId: String(ctx.chat.id),
      messageId: String(ctx.message.message_id),
    });
    return undefined;
  }

  if (!allowedUserIds.has(String(ctx.from.id))) {
    void logger?.debug("ignored telegram message from disallowed user", {
      endpointId,
      transport: "telegram",
      conversationId: String(ctx.chat.id),
      messageId: String(ctx.message.message_id),
    });
    return undefined;
  }

  return {
    chat: ctx.chat,
    message: ctx.message,
    from: ctx.from,
    reply: ctx.reply.bind(ctx),
  };
}

function getTelegramTextMessage(message: TelegramMessage): (TelegramMessage & { text: string }) | undefined {
  return typeof message.text === "string" ? (message as TelegramMessage & { text: string }) : undefined;
}

function getTelegramVoiceMessage(
  message: TelegramMessage,
): (TelegramMessage & { voice: { file_id: string; mime_type?: string } }) | undefined {
  return message.voice?.file_id
    ? (message as TelegramMessage & { voice: { file_id: string; mime_type?: string } })
    : undefined;
}

function getTelegramDocumentMessage(
  message: TelegramMessage,
): (TelegramMessage & { document: TelegramDocument }) | undefined {
  return message.document?.file_id
    ? (message as TelegramMessage & { document: TelegramDocument })
    : undefined;
}

function getTelegramPhotoMessage(
  message: TelegramMessage,
): (TelegramMessage & { photo: TelegramPhotoSize[] }) | undefined {
  return Array.isArray(message.photo) && message.photo.length > 0
    ? (message as TelegramMessage & { photo: TelegramPhotoSize[] })
    : undefined;
}

function getLargestTelegramPhoto(
  message: TelegramMessage & { photo: TelegramPhotoSize[] },
): TelegramPhotoSize | undefined {
  return message.photo.at(-1);
}

function getTelegramDocumentUserText(message: TelegramMessage & { document: TelegramDocument }): string {
  const caption = message.caption?.trim();
  if (caption) {
    return caption;
  }

  if (isTelegramImageDocument(message.document)) {
    return `A Telegram image was uploaded: ${message.document.file_name ?? "unnamed image"}.`;
  }

  return `A Telegram document was uploaded: ${message.document.file_name ?? "unnamed document"}.`;
}

function getTelegramPhotoUserText(message: TelegramMessage & { photo: TelegramPhotoSize[] }): string {
  const caption = message.caption?.trim();
  if (caption) {
    return caption;
  }

  return "A Telegram image was uploaded.";
}

async function transcribeTelegramVoiceMessage(
  message: TelegramMessage,
  config: TelegramEndpointRuntimeConfig,
  bot: TelegramBotAdapter,
  transcriber: VoiceTranscriber,
  fetchImpl: typeof fetch,
): Promise<string> {
  const voice = message.voice;
  if (!voice) {
    throw new Error("Telegram voice message did not include a voice payload.");
  }

  const file = await bot.api.getFile(voice.file_id);
  if (!file.file_path) {
    throw new Error("Telegram voice file metadata did not include file_path.");
  }

  const downloadedAudio = await downloadTelegramFile(file.file_path, config.token, fetchImpl);
  const mimeType = voice.mime_type ?? downloadedAudio.mimeType ?? "audio/ogg";
  const extension = mimeType === "audio/mpeg" ? "mp3" : "ogg";
  const transcript = await transcriber.transcribe({
    audio: downloadedAudio.bytes,
    fileName: `telegram-voice-${message.message_id}.${extension}`,
    mimeType,
    config: config.voice!.transcription,
  });

  return transcript.text.trim();
}

async function downloadTelegramFile(
  filePath: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  if (isAbsolute(filePath)) {
    return {
      bytes: new Uint8Array(await readFile(filePath)),
    };
  }

  const response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      `Telegram file download failed (${response.status} ${response.statusText}).`,
    );
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? undefined,
  };
}

async function persistTelegramDocument(input: {
  message: IncomingMessage;
  document: TelegramDocument;
  config: TelegramTransportRuntimeConfig;
  bot: TelegramBotAdapter;
  fetchImpl: typeof fetch;
}): Promise<IncomingMessage> {
  if (!("sessionId" in input.message.conversation) || !input.message.conversation.sessionId) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram document cannot be stored before the conversation session is resolved.",
    );
  }

  if (
    typeof input.document.file_size === "number" &&
    input.document.file_size > getTelegramDocumentMaxDownloadBytes(input.config)
  ) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      `Telegram document exceeds configured download size limit (${input.document.file_size} > ${getTelegramDocumentMaxDownloadBytes(input.config)}).`,
    );
  }

  const file = await input.bot.api.getFile(input.document.file_id);
  if (!file.file_path) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram document metadata did not include file_path.",
    );
  }

  const downloadedDocument = await downloadTelegramFile(file.file_path, input.config.token, input.fetchImpl);
  if (downloadedDocument.bytes.byteLength > getTelegramDocumentMaxDownloadBytes(input.config)) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      `Telegram document download exceeded configured size limit (${downloadedDocument.bytes.byteLength} > ${getTelegramDocumentMaxDownloadBytes(input.config)}).`,
    );
  }

  const savedPath = getTelegramDocumentSavedPath(input.config, input.message, input.document);
  const relativePath = getTelegramDocumentRelativePath(input.message, input.document);
  await mkdir(dirname(savedPath), { recursive: true });
  await writeFile(savedPath, downloadedDocument.bytes);

  return {
    ...input.message,
    source: {
      kind: "telegram-document",
      document: {
        fileId: input.document.file_id,
        ...(input.document.file_unique_id ? { fileUniqueId: input.document.file_unique_id } : {}),
        ...(input.document.file_name ? { fileName: input.document.file_name } : {}),
        ...(input.document.mime_type ?? downloadedDocument.mimeType
          ? { mimeType: input.document.mime_type ?? downloadedDocument.mimeType }
          : {}),
        sizeBytes: input.document.file_size ?? downloadedDocument.bytes.byteLength,
        relativePath,
        savedPath,
      },
    },
  };
}

async function persistTelegramImage(input: {
  message: IncomingMessage;
  image:
    | {
        kind: "document";
        document: TelegramDocument;
      }
    | {
        kind: "photo";
        photo: TelegramPhotoSize;
      };
  config: TelegramTransportRuntimeConfig;
  bot: TelegramBotAdapter;
  fetchImpl: typeof fetch;
}): Promise<IncomingMessage> {
  if (!("sessionId" in input.message.conversation) || !input.message.conversation.sessionId) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram image cannot be stored before the conversation session is resolved.",
    );
  }

  const fileId = input.image.kind === "document" ? input.image.document.file_id : input.image.photo.file_id;
  const declaredSize = input.image.kind === "document"
    ? input.image.document.file_size
    : input.image.photo.file_size;

  if (
    typeof declaredSize === "number" &&
    declaredSize > getTelegramDocumentMaxDownloadBytes(input.config)
  ) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      `Telegram image exceeds configured download size limit (${declaredSize} > ${getTelegramDocumentMaxDownloadBytes(input.config)}).`,
    );
  }

  const file = await input.bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram image metadata did not include file_path.",
    );
  }

  const downloadedImage = await downloadTelegramFile(file.file_path, input.config.token, input.fetchImpl);
  if (downloadedImage.bytes.byteLength > getTelegramDocumentMaxDownloadBytes(input.config)) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      `Telegram image download exceeded configured size limit (${downloadedImage.bytes.byteLength} > ${getTelegramDocumentMaxDownloadBytes(input.config)}).`,
    );
  }

  const savedPath = getTelegramImageSavedPath(input.config, input.message, input.image, file.file_path, downloadedImage.mimeType);
  const relativePath = getTelegramImageRelativePath(input.message, input.image, file.file_path, downloadedImage.mimeType);
  await mkdir(dirname(savedPath), { recursive: true });
  await writeFile(savedPath, downloadedImage.bytes);

  const sourceImage = input.image.kind === "document" ? input.image.document : input.image.photo;
  const mimeType = resolveTelegramImageMimeType(
    input.image.kind === "document" ? input.image.document.mime_type : undefined,
    downloadedImage.mimeType,
    file.file_path,
  );

  return {
    ...input.message,
    source: {
      kind: "telegram-image",
      image: {
        fileId: sourceImage.file_id,
        ...(sourceImage.file_unique_id ? { fileUniqueId: sourceImage.file_unique_id } : {}),
        ...(input.image.kind === "document" && input.image.document.file_name
          ? { fileName: input.image.document.file_name }
          : {}),
        ...(mimeType ? { mimeType } : {}),
        sizeBytes: declaredSize ?? downloadedImage.bytes.byteLength,
        ...(input.image.kind === "photo"
          ? {
              width: input.image.photo.width,
              height: input.image.photo.height,
            }
          : {}),
        relativePath,
        savedPath,
        telegramType: input.image.kind,
      },
    },
  };
}

function getTelegramDocumentSavedPath(
  config: TelegramTransportRuntimeConfig,
  message: IncomingMessage,
  document: TelegramDocument,
): string {
  const sessionId =
    "sessionId" in message.conversation && typeof message.conversation.sessionId === "string"
      ? message.conversation.sessionId
      : undefined;
  const agentId =
    "agentId" in message.conversation && typeof message.conversation.agentId === "string"
      ? message.conversation.agentId
      : undefined;
  if (!sessionId) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram document message did not include a session id.",
    );
  }
  if (!agentId) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram document message did not include an agent id.",
    );
  }

  const fileName = document.file_name ?? `telegram-document-${message.messageId}${getDocumentExtension(document)}`;
  return join(
    getTelegramConversationsDir(config),
    "agents",
    sanitizePathSegment(agentId),
    "sessions",
    sanitizePathSegment(sessionId),
    "attachments",
    `${sanitizePathSegment(message.messageId)}-${sanitizeFileName(fileName)}`,
  );
}

function getTelegramDocumentRelativePath(
  message: IncomingMessage,
  document: TelegramDocument,
): string {
  const fileName = document.file_name ?? `telegram-document-${message.messageId}${getDocumentExtension(document)}`;
  return join(
    "attachments",
    `${sanitizePathSegment(message.messageId)}-${sanitizeFileName(fileName)}`,
  );
}

function getTelegramImageSavedPath(
  config: TelegramTransportRuntimeConfig,
  message: IncomingMessage,
  image:
    | { kind: "document"; document: TelegramDocument }
    | { kind: "photo"; photo: TelegramPhotoSize },
  filePath: string,
  downloadedMimeType?: string,
): string {
  const sessionId =
    "sessionId" in message.conversation && typeof message.conversation.sessionId === "string"
      ? message.conversation.sessionId
      : undefined;
  const agentId =
    "agentId" in message.conversation && typeof message.conversation.agentId === "string"
      ? message.conversation.agentId
      : undefined;
  if (!sessionId) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram image message did not include a session id.",
    );
  }
  if (!agentId) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram image message did not include an agent id.",
    );
  }

  const fileName = getTelegramImageFileName(message, image, filePath, downloadedMimeType);
  return join(
    getTelegramConversationsDir(config),
    "agents",
    sanitizePathSegment(agentId),
    "sessions",
    sanitizePathSegment(sessionId),
    "attachments",
    `${sanitizePathSegment(message.messageId)}-${sanitizeFileName(fileName)}`,
  );
}

function getTelegramImageRelativePath(
  message: IncomingMessage,
  image:
    | { kind: "document"; document: TelegramDocument }
    | { kind: "photo"; photo: TelegramPhotoSize },
  filePath: string,
  downloadedMimeType?: string,
): string {
  return join(
    "attachments",
    `${sanitizePathSegment(message.messageId)}-${sanitizeFileName(
      getTelegramImageFileName(message, image, filePath, downloadedMimeType),
    )}`,
  );
}

function getTelegramDocumentMaxDownloadBytes(config: TelegramTransportRuntimeConfig): number {
  return config.document?.maxDownloadBytes ?? defaultTelegramDocumentMaxDownloadBytes;
}

function getTelegramConversationsDir(config: TelegramTransportRuntimeConfig): string {
  if (!config.paths?.conversationsDir) {
    throw new UserVisibleProcessingError(
      "file_document_persistence",
      "Telegram document cannot be stored because the endpoint conversations directory is unavailable.",
    );
  }

  return config.paths.conversationsDir;
}

function getDocumentExtension(document: TelegramDocument): string {
  if (document.mime_type === "application/pdf") {
    return ".pdf";
  }

  return "";
}

function getTelegramImageFileName(
  message: IncomingMessage,
  image:
    | { kind: "document"; document: TelegramDocument }
    | { kind: "photo"; photo: TelegramPhotoSize },
  filePath: string,
  downloadedMimeType?: string,
): string {
  if (image.kind === "document" && image.document.file_name) {
    return image.document.file_name;
  }

  const extension = getImageExtension(
    image.kind === "document" ? image.document.file_name : undefined,
    image.kind === "document" ? image.document.mime_type : undefined,
    downloadedMimeType,
    filePath,
  );

  return image.kind === "photo"
    ? `telegram-photo-${message.messageId}${extension}`
    : `telegram-image-${message.messageId}${extension}`;
}

function resolveTelegramImageMimeType(
  declaredMimeType: string | undefined,
  downloadedMimeType: string | undefined,
  filePath: string,
): string | undefined {
  if (isSupportedImageMimeType(declaredMimeType)) {
    return declaredMimeType;
  }

  if (isSupportedImageMimeType(downloadedMimeType)) {
    return downloadedMimeType;
  }

  return inferImageMimeType(filePath);
}

function isSupportedImageMimeType(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("image/");
}

function getImageExtension(
  fileName: string | undefined,
  mimeType: string | undefined,
  downloadedMimeType: string | undefined,
  filePath: string,
): string {
  const fileNameExtension = extname(fileName ?? "");
  if (fileNameExtension) {
    return fileNameExtension;
  }

  const mime = mimeType ?? downloadedMimeType ?? inferImageMimeType(filePath);
  if (mime === "image/png") {
    return ".png";
  }
  if (mime === "image/webp") {
    return ".webp";
  }
  if (mime === "image/gif") {
    return ".gif";
  }

  return ".jpg";
}

function inferImageMimeType(filePath: string): string | undefined {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  return undefined;
}

function isTelegramImageDocument(document: TelegramDocument): boolean {
  return typeof document.mime_type === "string" && document.mime_type.startsWith("image/");
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim();
  const cleaned = trimmed.replace(/[/\\]/g, "_").replace(/[^A-Za-z0-9._ -]/g, "_");
  const normalized = cleaned.replace(/^\.+/, "").slice(0, 160);
  if (normalized) {
    return normalized;
  }

  return `document${extname(trimmed)}`;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "unknown";
}

async function processTelegramEvent(
  handler: TransportHandler,
  event: TransportInboundEvent,
  options: {
    logger?: Logger;
    endpointId: string;
    conversationId: string;
    messageId: string;
    correlationId: string;
    startedAt: number;
  },
): Promise<void> {
  try {
    await handler.handle(event);
    await options.logger?.debug("processed telegram message", {
      endpointId: options.endpointId,
      transport: "telegram",
      conversationId: options.conversationId,
      messageId: options.messageId,
      correlationId: options.correlationId,
      durationMs: Date.now() - options.startedAt,
    });
  } catch (error) {
    await logTelegramProcessingFailure(
      options.logger,
      {
        endpointId: options.endpointId,
        conversationId: options.conversationId,
        messageId: options.messageId,
        correlationId: options.correlationId,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      error,
    );

    try {
      await event.deliverError?.(error);
    } catch (deliverErrorFailure) {
      await logTelegramTerminalFailure(
        options.logger,
        {
          endpointId: options.endpointId,
          conversationId: options.conversationId,
          messageId: options.messageId,
          correlationId: options.correlationId,
          errorType:
            deliverErrorFailure instanceof Error ? deliverErrorFailure.name : typeof deliverErrorFailure,
        },
        deliverErrorFailure,
      );
    }
  }
}

function detachTelegramEventProcessing(
  operation: Promise<void>,
  options: {
    logger?: Logger;
    endpointId: string;
    conversationId: string;
    messageId: string;
    correlationId: string;
  },
): void {
  void Promise.resolve()
    .then(() => operation)
    .catch((error) => {
      void logTelegramTerminalFailure(
        options.logger,
        {
          endpointId: options.endpointId,
          conversationId: options.conversationId,
          messageId: options.messageId,
          correlationId: options.correlationId,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        error,
      ).catch(() => {
        // Detached processing must never leak terminal failure logging errors.
      });
    });
}

async function logTelegramProcessingFailure(
  logger: Logger | undefined,
  fields: {
    endpointId: string;
    conversationId: string;
    messageId: string;
    correlationId: string;
    errorType: string;
  },
  error: unknown,
): Promise<void> {
  await safelyLogTelegramError(
    logger,
    "failed to process telegram message",
    {
      endpointId: fields.endpointId,
      transport: "telegram",
      conversationId: fields.conversationId,
      messageId: fields.messageId,
      correlationId: fields.correlationId,
      errorType: fields.errorType,
    },
    error,
  );
}

async function logTelegramTerminalFailure(
  logger: Logger | undefined,
  fields: {
    endpointId: string;
    conversationId: string;
    messageId: string;
    correlationId: string;
    errorType: string;
  },
  error: unknown,
): Promise<void> {
  await safelyLogTelegramError(
    logger,
    "telegram message processing terminated after an unhandled failure",
    {
      endpointId: fields.endpointId,
      transport: "telegram",
      conversationId: fields.conversationId,
      messageId: fields.messageId,
      correlationId: fields.correlationId,
      errorType: fields.errorType,
    },
    error,
  );
}

async function safelyLogTelegramError(
  logger: Logger | undefined,
  message: string,
  fields: {
    endpointId: string;
    transport: "telegram";
    conversationId: string;
    messageId: string;
    correlationId: string;
    errorType: string;
  },
  error: unknown,
): Promise<void> {
  try {
    await logger?.error(message, fields, error);
  } catch {
    // Detached processing must never leak secondary logging failures.
  }
}

function createTelegramInboundEvent(
  endpointId: string,
  correlationId: string,
  ctx: Required<Pick<TelegramMessageContext, "chat" | "message" | "from" | "reply">>,
  bot: TelegramBotAdapter,
  payload: {
    text: string;
    transcript?: string;
    source?: {
      kind: "text" | "telegram-voice-transcript" | "telegram-document" | "telegram-image";
      transcript?: {
        provider: string;
        model: string;
      };
    };
    document?: TelegramDocument;
    image?:
      | {
          kind: "document";
          document: TelegramDocument;
        }
      | {
          kind: "photo";
          photo: TelegramPhotoSize;
        };
    config?: TelegramTransportRuntimeConfig;
    fetchImpl?: typeof fetch;
    options?: { command: IncomingMessageCommand; commandArgs?: string };
  },
  logger?: Logger,
): TransportInboundEvent {
  return {
    message: {
      endpointId,
      conversation: {
        transport: "telegram",
        externalId: String(ctx.chat.id),
      },
      messageId: String(ctx.message.message_id),
      correlationId,
      userId: String(ctx.from.id),
      text: payload.text,
      receivedAt: new Date().toISOString(),
      ...(payload.source ? { source: payload.source } : {}),
      ...(payload.options ? payload.options : {}),
    },
    ...((payload.document || payload.image) && payload.config && payload.fetchImpl
      ? {
          async prepareMessage(message: IncomingMessage): Promise<IncomingMessage> {
            try {
              const prepared = payload.image
                ? await persistTelegramImage({
                    message,
                    image: payload.image,
                    config: payload.config!,
                    bot,
                    fetchImpl: payload.fetchImpl!,
                  })
                : await persistTelegramDocument({
                    message,
                    document: payload.document!,
                    config: payload.config!,
                    bot,
                    fetchImpl: payload.fetchImpl!,
                  });
              await logger?.debug(payload.image ? "stored telegram image" : "stored telegram document", {
                endpointId,
                transport: "telegram",
                conversationId: String(ctx.chat.id),
                messageId: String(ctx.message.message_id),
                correlationId,
              });
              return prepared;
            } catch (error) {
              await logger?.error(
                payload.image ? "failed to store telegram image" : "failed to store telegram document",
                {
                  endpointId,
                  transport: "telegram",
                  conversationId: String(ctx.chat.id),
                  messageId: String(ctx.message.message_id),
                  correlationId,
                  errorType: error instanceof Error ? error.name : typeof error,
                },
                error,
              );
              throw error instanceof UserVisibleProcessingError
                ? error
                : toTelegramDocumentPersistenceError(error);
            }
          },
        }
      : {}),
    async runWithProcessing<T>(operation: () => Promise<T>): Promise<T> {
      const stopTyping = startTypingStatus(bot, ctx.chat.id);
      try {
        return await operation();
      } finally {
        stopTyping();
      }
    },
    async deliver(message): Promise<void> {
      if (payload.transcript) {
        for (const chunk of renderTelegramMessages(`**Transcript**\n${payload.transcript}`)) {
          await ctx.reply(chunk, {
            parse_mode: "HTML",
          });
        }
      }

      for (const chunk of renderTelegramMessages(message.text)) {
        await ctx.reply(chunk, {
          parse_mode: "HTML",
        });
      }
      await sendTelegramAttachments(bot, ctx.chat.id, message);
      await sendTelegramReplay(bot, ctx.chat.id, message);
    },
    async deliverProgress(message): Promise<void> {
      if (payload.transcript) {
        for (const chunk of renderTelegramMessages(`**Transcript**
${payload.transcript}`)) {
          await ctx.reply(chunk, {
            parse_mode: "HTML",
          });
        }
      }

      for (const chunk of renderTelegramMessages(message.text)) {
        await ctx.reply(chunk, {
          parse_mode: "HTML",
        });
      }
      await sendTelegramAttachments(bot, ctx.chat.id, message);
      await sendTelegramReplay(bot, ctx.chat.id, message);
    },
    async deliverError(error?: unknown): Promise<void> {
      await logger?.debug("sending telegram processing error response", {
        endpointId,
        transport: "telegram",
        conversationId: String(ctx.chat.id),
        messageId: String(ctx.message.message_id),
        correlationId,
      });
      await ctx.reply(renderUserFacingError(error));
    },
  };
}

function toTelegramDocumentPersistenceError(error: unknown): UserVisibleProcessingError {
  if (isPermissionDeniedError(error)) {
    return new UserVisibleProcessingError("permission_denied", getErrorMessage(error));
  }

  if (isNetworkConnectivityError(error)) {
    return new UserVisibleProcessingError("network_connectivity", getErrorMessage(error));
  }

  return new UserVisibleProcessingError(
    "file_document_persistence",
    "Telegram document could not be downloaded or stored.",
  );
}

function isPermissionDeniedError(error: unknown): boolean {
  return isErrorWithCode(error, "EACCES") || isErrorWithCode(error, "EPERM");
}

function isNetworkConnectivityError(error: unknown): boolean {
  return [
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
  ].some((code) => isErrorWithCode(error, code))
    || (error instanceof TypeError && /fetch failed|network/i.test(error.message));
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendTelegramReplay(
  bot: TelegramBotAdapter,
  chatId: number | string,
  message: OutgoingMessage,
): Promise<void> {
  for (const item of message.replay ?? []) {
    for (const chunk of renderTelegramMessages(renderReplayItem(item))) {
      await bot.api.sendMessage(chatId, chunk, {
        parse_mode: "HTML",
      });
    }
  }
}

function renderReplayItem(item: OutgoingMessageReplayItem): string {
  const label = item.role === "user" ? "You" : "imp";
  return `**${label}**\n${item.text}`;
}

async function sendTelegramAttachments(
  bot: TelegramBotAdapter,
  chatId: number | string,
  message: OutgoingMessage,
): Promise<void> {
  for (const attachment of message.attachments ?? []) {
    await bot.api.sendDocument(
      chatId,
      new InputFile(attachment.path, attachment.fileName),
      {
        caption: attachment.fileName ?? "Export file",
      },
    );
  }
}

async function getTelegramBotProfile(
  bot: TelegramBotAdapter,
  config: TelegramEndpointRuntimeConfig,
): Promise<TelegramBotProfile> {
  try {
    return await bot.api.getMe();
  } catch (error) {
    if (error instanceof GrammyError) {
      throw new Error(
        `Invalid Telegram endpoint token for endpoint "${config.id}" (${error.error_code}: ${error.description})`,
      );
    }

    throw error;
  }
}

async function registerTelegramCommands(
  bot: TelegramBotAdapter,
  config: TelegramEndpointRuntimeConfig,
): Promise<void> {
  try {
    await bot.api.setMyCommands(inboundCommandMenu);
  } catch (error) {
    if (error instanceof GrammyError) {
      throw new Error(
        `Failed to register Telegram commands for endpoint "${config.id}" (${error.error_code}: ${error.description})`,
      );
    }

    throw error;
  }
}

function parseTelegramCommand(
  message: TelegramMessage,
  botUsername?: string,
): { command: IncomingMessageCommand; commandArgs?: string } | undefined {
  if (typeof message.text !== "string") {
    return undefined;
  }

  return parseInboundCommand(message.text, {
    botUsername,
    entities: message.entities,
    allowedCommands: inboundCommandNames,
  });
}

function startTypingStatus(bot: TelegramBotAdapter, chatId: number): () => void {
  let active = true;
  let timeout: NodeJS.Timeout | undefined;

  const scheduleNext = () => {
    if (!active) {
      return;
    }

    timeout = setTimeout(() => {
      void sendTyping();
    }, 4000);
  };

  const sendTyping = async () => {
    if (!active) {
      return;
    }

    try {
      await bot.api.sendChatAction(chatId, "typing");
    } catch {
      scheduleNext();
      return;
    }
    scheduleNext();
  };

  void sendTyping();

  return () => {
    active = false;
    if (timeout) {
      clearTimeout(timeout);
    }
  };
}
