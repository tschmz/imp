import { registerTransport } from "./registry.js";
import type { CliEndpointConfig, TelegramEndpointConfig } from "../config/types.js";
import {
  cliTransportConfigSchema,
  createCliTransportFromRuntimeConfig,
  normalizeCliRuntimeConfig,
} from "./cli/transport-adapter.js";
import {
  createTelegramTransportFromRuntimeConfig,
  normalizeTelegramRuntimeConfig,
  telegramTransportConfigSchema,
} from "./telegram/transport-adapter.js";

let builtInTransportsRegistered = false;

export function ensureBuiltInTransportsRegistered(): void {
  if (builtInTransportsRegistered) {
    return;
  }

  registerTransport("telegram", {
    configSchema: telegramTransportConfigSchema,
    createTransport: createTelegramTransportFromRuntimeConfig,
    normalizeRuntimeConfig: (endpoint, context) =>
      normalizeTelegramRuntimeConfig(endpoint as TelegramEndpointConfig, context),
  });

  registerTransport("cli", {
    configSchema: cliTransportConfigSchema,
    createTransport: createCliTransportFromRuntimeConfig,
    normalizeRuntimeConfig: (endpoint, context) =>
      normalizeCliRuntimeConfig(endpoint as CliEndpointConfig, context),
  });

  builtInTransportsRegistered = true;
}
