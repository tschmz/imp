import { randomUUID } from "node:crypto";
import { Bot, GrammyError } from "grammy";
import type { TelegramBotRuntimeConfig } from "../../daemon/types.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportHandler } from "../types.js";

interface TelegramBotAdapter {
  api: {
    getMe(): Promise<unknown>;
  };
  on(filter: "message:text", handler: (ctx: TelegramMessageContext) => Promise<void>): void;
  start(): Promise<void>;
}

interface TelegramMessageContext {
  chat?: {
    id: number;
    type: string;
  };
  message?: {
    message_id: number;
    text: string;
  };
  from?: {
    id: number;
  };
  reply(text: string): Promise<unknown>;
}

export function createTelegramTransport(
  config: TelegramBotRuntimeConfig,
  bot: TelegramBotAdapter = new Bot(config.token),
  logger?: Logger,
): Transport {
  const allowedUserIds = new Set(config.allowedUserIds);

  return {
    async start(handler: TransportHandler): Promise<void> {
      await validateBotToken(bot, config);

      bot.on("message:text", async (ctx) => {
        if (!ctx.chat || !ctx.message || !ctx.from) {
          return;
        }

        if (ctx.chat.type !== "private") {
          return;
        }

        if (!allowedUserIds.has(String(ctx.from.id))) {
          return;
        }

        const text = ctx.message.text.trim();
        if (!text) {
          return;
        }

        const startedAt = Date.now();
        const correlationId = randomUUID();

        try {
          const response = await handler.handle({
            botId: config.id,
            conversation: {
              transport: "telegram",
              externalId: String(ctx.chat.id),
            },
            messageId: String(ctx.message.message_id),
            correlationId,
            userId: String(ctx.from.id),
            text: ctx.message.text,
            receivedAt: new Date().toISOString(),
          });
          await ctx.reply(response.text);
        } catch (error) {
          await logger?.error(
            "failed to handle telegram message",
            {
              botId: config.id,
              transport: "telegram",
              conversationId: String(ctx.chat.id),
              messageId: String(ctx.message.message_id),
              durationMs: Date.now() - startedAt,
              errorType: error instanceof Error ? error.name : typeof error,
            },
            error,
          );
          await ctx.reply("Sorry, something went wrong while processing your message.");
        }
      });

      await bot.start();
    },
  };
}

async function validateBotToken(
  bot: TelegramBotAdapter,
  config: TelegramBotRuntimeConfig,
): Promise<void> {
  try {
    await bot.api.getMe();
  } catch (error) {
    if (error instanceof GrammyError) {
      throw new Error(
        `Invalid Telegram bot token for bot "${config.id}" (${error.error_code}: ${error.description})`,
      );
    }

    throw error;
  }
}
