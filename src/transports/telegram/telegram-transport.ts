import { Bot, GrammyError } from "grammy";
import type { TelegramBotRuntimeConfig } from "../../daemon/types.js";
import type { Transport, TransportHandler } from "../types.js";

export function createTelegramTransport(config: TelegramBotRuntimeConfig): Transport {
  const bot = new Bot(config.token);

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

        const text = ctx.message.text.trim();
        if (!text) {
          return;
        }

        const response = await handler.handle({
          conversation: {
            transport: "telegram",
            externalId: String(ctx.chat.id),
          },
          messageId: String(ctx.message.message_id),
          userId: String(ctx.from.id),
          text: ctx.message.text,
          receivedAt: new Date().toISOString(),
        });
        await ctx.reply(response.text);
      });

      await bot.start();
    },
  };
}

async function validateBotToken(
  bot: Bot,
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
