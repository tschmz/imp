import { Bot } from "grammy";
import type { Transport, TransportHandler } from "../types.js";

export interface TelegramTransportConfig {
  botToken: string;
}

export function createTelegramTransport(config: TelegramTransportConfig): Transport {
  const bot = new Bot(config.botToken);

  return {
    async start(handler: TransportHandler): Promise<void> {
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
