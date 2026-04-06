import { randomUUID } from "node:crypto";
import { Bot, GrammyError } from "grammy";
import { parseInboundCommand } from "../../application/commands/parse-inbound-command.js";
import { inboundCommandMenu, inboundCommandNames } from "../../application/commands/registry.js";
import type { TelegramBotRuntimeConfig } from "../../daemon/types.js";
import type { IncomingMessageCommand } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportHandler, TransportInboundEvent } from "../types.js";
import { renderTelegramMessages } from "./render-telegram-message.js";

interface TelegramBotAdapter {
  api: {
    getMe(): Promise<TelegramBotProfile>;
    sendChatAction(chatId: number, action: "typing"): Promise<unknown>;
    setMyCommands(commands: ReadonlyArray<{ command: string; description: string }>): Promise<unknown>;
  };
  on(filter: "message:text", handler: (ctx: TelegramMessageContext) => Promise<void>): void;
  start(): Promise<void>;
  stop(): void;
}

interface TelegramBotProfile {
  username?: string;
}

interface TelegramMessageContext {
  chat?: {
    id: number;
    type: string;
  };
  message?: {
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
    }>;
    message_id: number;
    text: string;
  };
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

export function createTelegramTransport(
  config: TelegramBotRuntimeConfig,
  bot: TelegramBotAdapter = new Bot(config.token),
  logger?: Logger,
): Transport {
  const allowedUserIds = new Set(config.allowedUserIds);

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
        if (!ctx.chat || !ctx.message || !ctx.from) {
          await logger?.debug("ignored telegram update without chat, message, or sender", {
            botId: config.id,
            transport: "telegram",
          });
          return;
        }

        if (ctx.chat.type !== "private") {
          await logger?.debug("ignored non-private telegram chat", {
            botId: config.id,
            transport: "telegram",
            conversationId: String(ctx.chat.id),
            messageId: String(ctx.message.message_id),
          });
          return;
        }

        if (!allowedUserIds.has(String(ctx.from.id))) {
          await logger?.debug("ignored telegram message from disallowed user", {
            botId: config.id,
            transport: "telegram",
            conversationId: String(ctx.chat.id),
            messageId: String(ctx.message.message_id),
          });
          return;
        }

        const text = ctx.message.text.trim();
        if (!text) {
          await logger?.debug("ignored empty telegram message", {
            botId: config.id,
            transport: "telegram",
            conversationId: String(ctx.chat.id),
            messageId: String(ctx.message.message_id),
          });
          return;
        }

        const startedAt = Date.now();
        const correlationId = randomUUID();
        const chatId = String(ctx.chat.id);
        const telegramMessageId = String(ctx.message.message_id);
        const safeContext = {
          chat: ctx.chat,
          message: ctx.message,
          from: ctx.from,
          reply: ctx.reply.bind(ctx),
        };
        const event = createTelegramInboundEvent(
          config.id,
          correlationId,
          safeContext,
          bot,
          parseTelegramCommand(ctx.message, profile.username),
          logger,
        );
        await logger?.debug("received telegram message", {
          botId: config.id,
          transport: "telegram",
          conversationId: chatId,
          messageId: telegramMessageId,
          correlationId,
        });
        detachTelegramEventProcessing(
          processTelegramEvent(handler, event, {
            logger,
            botId: config.id,
            conversationId: chatId,
            messageId: telegramMessageId,
            correlationId,
            startedAt,
          }),
          {
            logger,
            botId: config.id,
            conversationId: chatId,
            messageId: telegramMessageId,
            correlationId,
          },
        );
      });

      await bot.start();
    },
    async stop(): Promise<void> {
      bot.stop();
    },
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
  options?: { command: IncomingMessageCommand; commandArgs?: string },
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
      text: ctx.message.text,
      receivedAt: new Date().toISOString(),
      ...(options ? options : {}),
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
  message: Required<Pick<TelegramMessageContext, "message">>["message"],
  botUsername?: string,
): { command: IncomingMessageCommand; commandArgs?: string } | undefined {
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
