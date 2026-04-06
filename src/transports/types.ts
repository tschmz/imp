import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";

export type TransportFactory<TConfig = unknown, TLogger = unknown> = (
  config: TConfig,
  logger: TLogger,
) => Transport;

export interface TransportInboundEvent {
  message: IncomingMessage;
  runWithProcessing<T>(operation: () => Promise<T>): Promise<T>;
  deliver(message: OutgoingMessage): Promise<void>;
  deliverError?(error: unknown): Promise<void>;
}

export interface TransportHandler {
  handle(event: TransportInboundEvent): Promise<void>;
}

export interface Transport {
  start(handler: TransportHandler): Promise<void>;
  stop?(): Promise<void> | void;
}
