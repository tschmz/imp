import type { Transport, TransportHandler } from "../types.js";

export interface TelegramTransportConfig {
  botToken: string;
}

export function createTelegramTransport(config: TelegramTransportConfig): Transport {
  return {
    async start(handler: TransportHandler): Promise<void> {
      void config;
      void handler;
      throw new Error("Telegram transport is not implemented yet");
    },
  };
}
