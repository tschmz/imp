import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Bot, GrammyError } from "grammy";
import { parseInboundCommand } from "../../application/commands/parse-inbound-command.js";
import { inboundCommandMenu, inboundCommandNames } from "../../application/commands/registry.js";
import type { TelegramBotRuntimeConfig } from "../../daemon/types.js";
import type { IncomingMessageCommand } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportHandler, TransportInboundEvent } from "../types.js";
import {
  createOpenAiVoiceTranscriber,
  type VoiceTranscriber,
} from "./openai-voice-transcriber.js";
import { renderTelegramMessages } from "./render-telegram-message.js";

interface TelegramBotAdapter {
  api: {
    getMe(): Promise<TelegramBotProfile>;
    getFile(fileId: string): Promise<TelegramFile>;
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
  config: TelegramBotRuntimeConfig,
  bot: TelegramBotAdapter = new Bot(config.token),
  logger?: Logger,
  dependencies: TelegramTransportDependencies = {},
): Transport {
  const allowedUserIds = new Set(config.allowedUserIds);
  const fetchImpl = dependencies.fetch ?? fetch;
  const voiceTranscriber =
    dependencies.voiceTranscriber ??
    (config.voice?.enabled ? createOpenAiVoiceTranscriber() : undefined);

  return {
    async start(handler: TransportHandler): Promise<void> {
      const profile = await getTelegramBotProfile(bot, config);
      await logger?.debug("validated telegram bot token", {
        botId: config.id,
        transport: "telegram",
      });

      await registerTelegramCommands(bot, config);
      await logger?.debug("registered telegram bot commands", {
        botId: config.id,
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
            botId: config.id,
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
        if (!voiceMessage) {
          return;
        }

        const correlationId = randomUUID();
        const messageId = String(voiceMessage.message_id);
        const conversationId = String(safeContext.chat.id);

        if (!config.voice?.enabled || !voiceTranscriber) {
          await logger?.debug("ignored telegram voice message because voice transcription is disabled", {
            botId: config.id,
            transport: "telegram",
            conversationId,
            messageId,
            correlationId,
          });
          await safeContext.reply("Voice messages are not enabled for this bot.");
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
            botId: config.id,
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
              botId: config.id,
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
      });

      await bot.start();
    },
    async stop(): Promise<void> {
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
    botId: event.message.botId,
    transport: "telegram",
    conversationId,
    messageId,
    correlationId,
  });

  detachTelegramEventProcessing(
    processTelegramEvent(handler, event, {
      logger,
      botId: event.message.botId,
      conversationId,
      messageId,
      correlationId,
      startedAt,
    }),
    {
      logger,
      botId: event.message.botId,
      conversationId,
      messageId,
      correlationId,
    },
  );
}

function validateTelegramContext(
  ctx: TelegramMessageContext,
  botId: string,
  allowedUserIds: Set<string>,
  logger?: Logger,
): Required<Pick<TelegramMessageContext, "chat" | "message" | "from" | "reply">> | undefined {
  if (!ctx.chat || !ctx.message || !ctx.from) {
    void logger?.debug("ignored telegram update without chat, message, or sender", {
      botId,
      transport: "telegram",
    });
    return undefined;
  }

  if (ctx.chat.type !== "private") {
    void logger?.debug("ignored non-private telegram chat", {
      botId,
      transport: "telegram",
      conversationId: String(ctx.chat.id),
      messageId: String(ctx.message.message_id),
    });
    return undefined;
  }

  if (!allowedUserIds.has(String(ctx.from.id))) {
    void logger?.debug("ignored telegram message from disallowed user", {
      botId,
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

async function transcribeTelegramVoiceMessage(
  message: TelegramMessage,
  config: TelegramBotRuntimeConfig,
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

async function processTelegramEvent(
  handler: TransportHandler,
  event: TransportInboundEvent,
  options: {
    logger?: Logger;
    botId: string;
    conversationId: string;
    messageId: string;
    correlationId: string;
    startedAt: number;
  },
): Promise<void> {
  try {
    await handler.handle(event);
    await options.logger?.debug("processed telegram message", {
      botId: options.botId,
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
        botId: options.botId,
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
          botId: options.botId,
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
    botId: string;
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
          botId: options.botId,
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
    botId: string;
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
      botId: fields.botId,
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
    botId: string;
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
      botId: fields.botId,
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
    botId: string;
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
  botId: string,
  correlationId: string,
  ctx: Required<Pick<TelegramMessageContext, "chat" | "message" | "from" | "reply">>,
  bot: TelegramBotAdapter,
  payload: {
    text: string;
    transcript?: string;
    source?: {
      kind: "text" | "telegram-voice-transcript";
      transcript?: {
        provider: string;
        model: string;
      };
    };
    options?: { command: IncomingMessageCommand; commandArgs?: string };
  },
  logger?: Logger,
): TransportInboundEvent {
  return {
    message: {
      botId,
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
    async deliverError(): Promise<void> {
      await logger?.debug("sending telegram processing error response", {
        botId,
        transport: "telegram",
        conversationId: String(ctx.chat.id),
        messageId: String(ctx.message.message_id),
        correlationId,
      });
      await ctx.reply("Sorry, something went wrong while processing your message.");
    },
  };
}

async function getTelegramBotProfile(
  bot: TelegramBotAdapter,
  config: TelegramBotRuntimeConfig,
): Promise<TelegramBotProfile> {
  try {
    return await bot.api.getMe();
  } catch (error) {
    if (error instanceof GrammyError) {
      throw new Error(
        `Invalid Telegram bot token for bot "${config.id}" (${error.error_code}: ${error.description})`,
      );
    }

    throw error;
  }
}

async function registerTelegramCommands(
  bot: TelegramBotAdapter,
  config: TelegramBotRuntimeConfig,
): Promise<void> {
  try {
    await bot.api.setMyCommands(inboundCommandMenu);
  } catch (error) {
    if (error instanceof GrammyError) {
      throw new Error(
        `Failed to register Telegram commands for bot "${config.id}" (${error.error_code}: ${error.description})`,
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
