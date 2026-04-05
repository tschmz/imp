import type { IncomingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import type { TransportHandler, TransportInboundEvent } from "../transports/types.js";

export interface MessageProcessorDependencies {
  handler: {
    handle(message: IncomingMessage): Promise<import("../domain/message.js").OutgoingMessage>;
  };
  logger?: Logger;
  maxParallel?: number;
  shouldRetry?: (error: unknown, attempt: number, event: TransportInboundEvent) => boolean | Promise<boolean>;
  retryDelayMs?: (attempt: number, event: TransportInboundEvent) => number | Promise<number>;
  onError?: (error: unknown, attempt: number, event: TransportInboundEvent) => Promise<void> | void;
  onRetry?: (error: unknown, attempt: number, event: TransportInboundEvent) => Promise<void> | void;
}

export type MessageProcessor = TransportHandler;

export function createMessageProcessor(
  dependencies: MessageProcessorDependencies,
): MessageProcessor {
  const semaphore = createSemaphore(Math.max(1, dependencies.maxParallel ?? 4));
  const conversationQueues = new Map<string, Promise<void>>();

  return {
    async handle(event: TransportInboundEvent): Promise<void> {
      await enqueueByConversation(event, async () => {
        await semaphore.withPermit(async () => {
          await processEvent(event, dependencies);
        });
      });
    },
  };

  async function enqueueByConversation(
    event: TransportInboundEvent,
    operation: () => Promise<void>,
  ): Promise<void> {
    const key = `${event.message.conversation.transport}/${event.message.conversation.externalId}`;
    const previous = conversationQueues.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => current);

    conversationQueues.set(key, next);
    await previous.catch(() => undefined);

    try {
      await operation();
    } finally {
      release?.();
      if (conversationQueues.get(key) === next) {
        conversationQueues.delete(key);
      }
    }
  }
}

async function processEvent(
  event: TransportInboundEvent,
  dependencies: MessageProcessorDependencies,
): Promise<void> {
  let attempt = 1;

  for (;;) {
    try {
      await event.runWithProcessing(async () => {
        const response = await dependencies.handler.handle(event.message);
        await event.deliver(response);
      });
      return;
    } catch (error) {
      const shouldRetry = await dependencies.shouldRetry?.(error, attempt, event);
      if (shouldRetry) {
        await dependencies.onRetry?.(error, attempt, event);
        const retryDelayMs = (await dependencies.retryDelayMs?.(attempt, event)) ?? 0;
        if (retryDelayMs > 0) {
          await delay(retryDelayMs);
        }
        attempt += 1;
        continue;
      }

      await dependencies.logger?.error(
        "failed to process inbound message",
        {
          botId: event.message.botId,
          transport: event.message.conversation.transport,
          conversationId: event.message.conversation.externalId,
          messageId: event.message.messageId,
          correlationId: event.message.correlationId,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        error,
      );
      await dependencies.onError?.(error, attempt, event);
      await event.deliverError?.(error);
      return;
    }
  }
}

function createSemaphore(maxPermits: number): {
  withPermit<T>(operation: () => Promise<T>): Promise<T>;
} {
  let availablePermits = maxPermits;
  const waiters: Array<() => void> = [];

  return {
    async withPermit<T>(operation: () => Promise<T>): Promise<T> {
      if (availablePermits === 0) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      } else {
        availablePermits -= 1;
      }

      try {
        return await operation();
      } finally {
        const next = waiters.shift();
        if (next) {
          next();
        } else {
          availablePermits += 1;
        }
      }
    },
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
