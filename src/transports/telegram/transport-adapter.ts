import { join } from "node:path";
import { z } from "zod";
import { secretValueConfigSchema } from "../../config/secret-value.js";
import type { TelegramBotConfig } from "../../config/types.js";
import type { ActiveBotRuntimeConfig } from "../../daemon/types.js";
import type { Logger } from "../../logging/types.js";
import type { Transport } from "../types.js";
import { createTelegramTransport } from "./telegram-transport.js";

export const telegramTransportConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal("telegram"),
  enabled: z.boolean(),
  token: secretValueConfigSchema,
  access: z.object({
    allowedUserIds: z
      .string()
      .array()
      .refine((values) => values.every((value) => /^\d+$/.test(value)), {
        message: "Telegram user IDs must contain digits only.",
      }),
  }),
  routing: z
    .object({
      defaultAgentId: z.string().min(1).optional(),
    })
    .optional(),
  voice: z
    .object({
      enabled: z.boolean(),
      transcription: z.object({
        provider: z.literal("openai"),
        model: z.string().min(1),
        language: z.string().min(1).optional(),
      }),
    })
    .optional(),
});

export function normalizeTelegramRuntimeConfig(
  bot: TelegramBotConfig,
  options: { dataRoot: string; defaultAgentId: string },
): ActiveBotRuntimeConfig {
  if (typeof bot.token !== "string") {
    throw new Error(`Telegram bot "${bot.id}" token must be resolved before runtime normalization.`);
  }

  const botRoot = join(options.dataRoot, "bots", bot.id);

  return {
    id: bot.id,
    type: bot.type,
    token: bot.token,
    allowedUserIds: bot.access.allowedUserIds,
    ...(bot.voice ? { voice: bot.voice } : {}),
    defaultAgentId: bot.routing?.defaultAgentId ?? options.defaultAgentId,
    paths: {
      dataRoot: options.dataRoot,
      botRoot,
      conversationsDir: join(botRoot, "conversations"),
      logsDir: join(botRoot, "logs"),
      logFilePath: join(botRoot, "logs", "daemon.log"),
      runtimeDir: join(botRoot, "runtime"),
      runtimeStatePath: join(botRoot, "runtime", "daemon.json"),
    },
  };
}

export function createTelegramTransportFromRuntimeConfig(
  config: ActiveBotRuntimeConfig,
  logger: Logger,
): Transport {
  return createTelegramTransport(config, undefined, logger);
}
