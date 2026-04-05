import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";

export interface TransportHandler {
  handle(message: IncomingMessage): Promise<OutgoingMessage>;
}

export interface Transport {
  start(handler: TransportHandler): Promise<void>;
  stop?(): Promise<void> | void;
}
