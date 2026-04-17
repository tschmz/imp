import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";
import { Bot, GrammyError } from "grammy";
import { parseInboundCommand } from "../../application/commands/parse-inbound-command.js";
import { inboundCommandMenu, inboundCommandNames } from "../../application/commands/registry.js";
import type { TelegramEndpointRuntimeConfig } from "../../daemon/types.js";
import type { IncomingMessage, IncomingMessageCommand } from "../../domain/message.js";
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
        if (!documentMessage) {
          return;
        }

        const correlationId = randomUUID();
        const messageId = String(documentMessage.message_id);
        const conversationId = String(safeContext.chat.id);
        const sizeBytes = documentMessage.document.file_size;

        const maxDownloadBytes = getTelegramDocumentMaxDownloadBytes(config);
        if (typeof sizeBytes === "number" && sizeBytes > maxDownloadBytes) {
          await logger?.error("telegram document exceeds configured download size limit", {
            endpointId: config.id,
            transport: "telegram",
            conversationId,
            messageId,
            correlationId,
          });
          await safeContext.reply(
            `Sorry, that document is too large. The current limit is ${maxDownloadBytes} bytes.`,
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
              document: documentMessage.document,
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

function getTelegramDocumentUserText(message: TelegramMessage & { document: TelegramDocument }): string {
  const caption = message.caption?.trim();
  if (caption) {
    return caption;
  }

  return `A Telegram document was uploaded: ${message.document.file_name ?? "unnamed document"}.`;
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
    throw new Error(`Telegram file download failed (${response.status} ${response.statusText}).`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? undefined,
  };
}

class TelegramDocumentPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramDocumentPersistenceError";
  }
}

async function persistTelegramDocument(input: {
  message: IncomingMessage;
  document: TelegramDocument;
  config: TelegramTransportRuntimeConfig;
  bot: TelegramBotAdapter;
  fetchImpl: typeof fetch;
}): Promise<IncomingMessage> {
  if (!("sessionId" in input.message.conversation) || !input.message.conversation.sessionId) {
    throw new TelegramDocumentPersistenceError(
      "Telegram document cannot be stored before the conversation session is resolved.",
    );
  }

  if (
    typeof input.document.file_size === "number" &&
    input.document.file_size > getTelegramDocumentMaxDownloadBytes(input.config)
  ) {
    throw new TelegramDocumentPersistenceError(
      `Telegram document exceeds configured download size limit (${input.document.file_size} > ${getTelegramDocumentMaxDownloadBytes(input.config)}).`,
    );
  }

  const file = await input.bot.api.getFile(input.document.file_id);
  if (!file.file_path) {
    throw new TelegramDocumentPersistenceError("Telegram document metadata did not include file_path.");
  }

  const downloadedDocument = await downloadTelegramFile(file.file_path, input.config.token, input.fetchImpl);
  if (downloadedDocument.bytes.byteLength > getTelegramDocumentMaxDownloadBytes(input.config)) {
    throw new TelegramDocumentPersistenceError(
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

function getTelegramDocumentSavedPath(
  config: TelegramTransportRuntimeConfig,
  message: IncomingMessage,
  document: TelegramDocument,
): string {
  const sessionId =
    "sessionId" in message.conversation && typeof message.conversation.sessionId === "string"
      ? message.conversation.sessionId
      : undefined;
  if (!sessionId) {
    throw new TelegramDocumentPersistenceError("Telegram document message did not include a session id.");
  }

  const fileName = document.file_name ?? `telegram-document-${message.messageId}${getDocumentExtension(document)}`;
  return join(
    getTelegramConversationsDir(config),
    sanitizePathSegment(message.conversation.transport),
    sanitizePathSegment(message.conversation.externalId),
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

function getTelegramDocumentMaxDownloadBytes(config: TelegramTransportRuntimeConfig): number {
  return config.document?.maxDownloadBytes ?? defaultTelegramDocumentMaxDownloadBytes;
}

function getTelegramConversationsDir(config: TelegramTransportRuntimeConfig): string {
  if (!config.paths?.conversationsDir) {
    throw new TelegramDocumentPersistenceError(
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
      kind: "text" | "telegram-voice-transcript" | "telegram-document";
      transcript?: {
        provider: string;
        model: string;
      };
    };
    document?: TelegramDocument;
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
    ...(payload.document && payload.config && payload.fetchImpl
      ? {
          async prepareMessage(message: IncomingMessage): Promise<IncomingMessage> {
            try {
              const prepared = await persistTelegramDocument({
                message,
                document: payload.document!,
                config: payload.config!,
                bot,
                fetchImpl: payload.fetchImpl!,
              });
              await logger?.debug("stored telegram document", {
                endpointId,
                transport: "telegram",
                conversationId: String(ctx.chat.id),
                messageId: String(ctx.message.message_id),
                correlationId,
              });
              return prepared;
            } catch (error) {
              await logger?.error(
                "failed to store telegram document",
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
              throw error instanceof TelegramDocumentPersistenceError
                ? error
                : new TelegramDocumentPersistenceError("Telegram document could not be downloaded or stored.");
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
    },
    async deliverError(error?: unknown): Promise<void> {
      await logger?.debug("sending telegram processing error response", {
        endpointId,
        transport: "telegram",
        conversationId: String(ctx.chat.id),
        messageId: String(ctx.message.message_id),
        correlationId,
      });
      if (error instanceof TelegramDocumentPersistenceError) {
        await ctx.reply("Sorry, I couldn't download or store that document.");
        return;
      }

      await ctx.reply("Sorry, something went wrong while processing your message.");
    },
  };
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
