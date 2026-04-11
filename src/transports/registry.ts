import type { ZodType } from "zod";
import type { BotConfig } from "../config/types.js";
import type { ActiveBotRuntimeConfig } from "../daemon/types.js";
import { TransportResolutionError } from "../domain/errors.js";
import type { Logger } from "../logging/types.js";
import type { SkillDefinition } from "../skills/types.js";
import type { Transport } from "./types.js";
import {
  createTelegramTransportFromRuntimeConfig,
  normalizeTelegramRuntimeConfig,
  telegramTransportConfigSchema,
} from "./telegram/transport-adapter.js";

interface RuntimeNormalizationContext {
  dataRoot: string;
  defaultAgentId: string;
  skillCatalog: SkillDefinition[];
  skillIssues: string[];
}

interface TransportRegistryEntry<TBot extends BotConfig = BotConfig> {
  configSchema: ZodType<TBot>;
  createTransport: (config: ActiveBotRuntimeConfig, logger: Logger) => Transport;
  normalizeRuntimeConfig: (bot: TBot, context: RuntimeNormalizationContext) => ActiveBotRuntimeConfig;
}

const transportRegistry = {
  telegram: {
    configSchema: telegramTransportConfigSchema,
    createTransport: createTelegramTransportFromRuntimeConfig,
    normalizeRuntimeConfig: normalizeTelegramRuntimeConfig,
  },
} as const satisfies Record<string, TransportRegistryEntry>;

export type TransportType = keyof typeof transportRegistry;

export const transportConfigSchemas: {
  [K in TransportType]: (typeof transportRegistry)[K]["configSchema"];
} = {
  telegram: transportRegistry.telegram.configSchema,
};


export type TransportConfigSchemaMap = typeof transportConfigSchemas;
export type TransportConfigSchema<TType extends TransportType> = TransportConfigSchemaMap[TType];

export function createTransport(type: TransportType, config: ActiveBotRuntimeConfig, logger: Logger): Transport {
  const entry = transportRegistry[type];
  if (!entry) {
    throw new TransportResolutionError(`Unsupported bot transport: ${type}`);
  }

  return entry.createTransport(config, logger);
}

export function normalizeRuntimeBotConfig(
  bot: BotConfig,
  context: RuntimeNormalizationContext,
): ActiveBotRuntimeConfig {
  const entry = transportRegistry[bot.type];
  if (!entry) {
    throw new TransportResolutionError(`Unsupported bot type: ${bot.type}`);
  }

  return entry.normalizeRuntimeConfig(bot, context);
}
