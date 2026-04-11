import { registerTransport } from "./registry.js";
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
    normalizeRuntimeConfig: normalizeTelegramRuntimeConfig,
  });

  builtInTransportsRegistered = true;
}
