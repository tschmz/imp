import type { ZodType } from "zod";
import type { BotConfig } from "../config/types.js";
import type { ActiveBotRuntimeConfig } from "../daemon/types.js";
import type { Logger } from "../logging/types.js";
import type { SkillDefinition } from "../skills/types.js";
import type { Transport } from "./types.js";
import { ensureBuiltInTransportsRegistered } from "./builtins.js";

interface RuntimeNormalizationContext {
  dataRoot: string;
  defaultAgentId: string;
  skillCatalog: SkillDefinition[];
  skillIssues: string[];
}

export interface TransportRegistryEntry<TBot extends BotConfig = BotConfig> {
  configSchema: ZodType<TBot>;
  createTransport: (config: ActiveBotRuntimeConfig, logger: Logger) => Transport;
  normalizeRuntimeConfig: (bot: TBot, context: RuntimeNormalizationContext) => ActiveBotRuntimeConfig;
}

const transportRegistry = new Map<string, TransportRegistryEntry>();

ensureBuiltInTransportsRegistered();

export type TransportType = string;

export function registerTransport(type: string, entry: TransportRegistryEntry): void {
  transportRegistry.set(type, entry);
}

export function getTransport(type: string): TransportRegistryEntry | undefined {
  return transportRegistry.get(type);
}

export function listTransportTypes(): string[] {
  return [...transportRegistry.keys()];
}

export function createTransport(type: TransportType, config: ActiveBotRuntimeConfig, logger: Logger): Transport {
  const entry = getTransport(type);
  if (!entry) {
    throw new Error(`Unsupported bot transport: ${type}`);
  }

  return entry.createTransport(config, logger);
}

export function normalizeRuntimeBotConfig(
  bot: BotConfig,
  context: RuntimeNormalizationContext,
): ActiveBotRuntimeConfig {
  const entry = getTransport(bot.type);
  if (!entry) {
    throw new Error(`Unsupported bot type: ${bot.type}`);
  }

  return entry.normalizeRuntimeConfig(bot, context);
}
