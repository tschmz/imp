import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { DeliveryRouter } from "./delivery-router.js";

export type TransportFactory<TConfig = unknown, TLogger = unknown> = (
  config: TConfig,
  logger: TLogger,
  context: TransportContext,
) => Transport;

export interface TransportContext {
  deliveryRouter: DeliveryRouter;
  endpointTransportById?: ReadonlyMap<string, string>;
}

export interface TransportInboundEvent {
  message: IncomingMessage;
  prepareMessage?(message: IncomingMessage): Promise<IncomingMessage> | IncomingMessage;
  runWithProcessing<T>(operation: () => Promise<T>): Promise<T>;
  deliver(message: OutgoingMessage): Promise<void>;
  deliverProgress?(message: OutgoingMessage): Promise<void>;
  deliverError?(error: unknown): Promise<void>;
}

export interface TransportHandler {
  handle(event: TransportInboundEvent): Promise<void>;
}

export interface Transport {
  start(handler: TransportHandler): Promise<void>;
  stop?(): Promise<void> | void;
}
