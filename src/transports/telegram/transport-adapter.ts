import { join } from "node:path";
import { z } from "zod";
import { secretValueConfigSchema } from "../../config/secret-value.js";
import type { TelegramEndpointConfig } from "../../config/types.js";
import type { ActiveEndpointRuntimeConfig, TelegramEndpointRuntimeConfig } from "../../daemon/types.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportContext } from "../types.js";
import { createTelegramTransport } from "./telegram-transport.js";

const defaultTelegramDocumentMaxDownloadBytes = 20 * 1024 * 1024;

const endpointIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Endpoint ids may only contain letters, numbers, hyphens, and underscores.",
  );

export const telegramTransportConfigSchema = z.object({
  id: endpointIdSchema,
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
  document: z
    .object({
      maxDownloadBytes: z.number().int().positive().optional(),
    })
    .optional(),
}).strict();

export function normalizeTelegramRuntimeConfig(
  endpoint: TelegramEndpointConfig,
  options: {
    dataRoot: string;
    defaultAgentId: string;
  },
): ActiveEndpointRuntimeConfig {
  if (typeof endpoint.token !== "string") {
    throw new Error(`Telegram endpoint "${endpoint.id}" token must be resolved before runtime normalization.`);
  }

  const logsDir = join(options.dataRoot, "logs");
  const runtimeDir = join(options.dataRoot, "runtime", "endpoints");

  return {
    id: endpoint.id,
    type: endpoint.type,
    token: endpoint.token,
    allowedUserIds: endpoint.access.allowedUserIds,
    ...(endpoint.voice ? { voice: endpoint.voice } : {}),
    document: {
      maxDownloadBytes: endpoint.document?.maxDownloadBytes ?? defaultTelegramDocumentMaxDownloadBytes,
    },
    defaultAgentId: endpoint.routing?.defaultAgentId ?? options.defaultAgentId,
    paths: {
      dataRoot: options.dataRoot,
      conversationsDir: join(options.dataRoot, "conversations"),
      logsDir,
      logFilePath: join(logsDir, "endpoints.log"),
      runtimeDir,
      runtimeStatePath: join(runtimeDir, `${endpoint.id}.json`),
    },
  };
}

export function createTelegramTransportFromRuntimeConfig(
  config: ActiveEndpointRuntimeConfig,
  logger: Logger,
  context: TransportContext,
): Transport {
  if (config.type !== "telegram") {
    throw new Error(`Expected Telegram endpoint runtime config, got "${config.type}".`);
  }

  return createTelegramTransport(config as TelegramEndpointRuntimeConfig, undefined, logger, {}, context);
}
