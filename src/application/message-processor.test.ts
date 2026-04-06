import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { createMessageProcessor } from "./message-processor.js";

describe("createMessageProcessor", () => {
  it("preserves message order within a conversation while allowing other conversations to run", async () => {
    let active = 0;
    let maxActive = 0;
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(message.messageId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => {
          releases.set(message.messageId, resolve);
        });
        active -= 1;
        return {
          conversation: message.conversation,
          text: `reply:${message.messageId}`,
        };
      }),
    };

    const processor = createMessageProcessor({
      handler,
      maxParallel: 2,
    });

    const first = processor.handle(createEvent(createIncomingMessage("1", "42")));
    const second = processor.handle(createEvent(createIncomingMessage("2", "42")));
    const third = processor.handle(createEvent(createIncomingMessage("3", "99")));

    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toEqual(["1", "3"]);
    expect(maxActive).toBe(2);

    releases.get("3")?.();
    await third;
    expect(starts).toEqual(["1", "3"]);

    releases.get("1")?.();
    await tick();
    expect(starts).toEqual(["1", "3", "2"]);

    releases.get("2")?.();
    await Promise.all([first, second]);
  });

  it("retries through central hooks before surfacing a terminal error response", async () => {
    const deliveredErrors: unknown[] = [];
    const onRetry = vi.fn(async () => {});
    const onError = vi.fn(async () => {});
    const handler = {
      handle: vi
        .fn<(message: IncomingMessage) => Promise<OutgoingMessage>>()
        .mockRejectedValueOnce(new Error("transient"))
        .mockRejectedValueOnce(new Error("fatal")),
    };

    const processor = createMessageProcessor({
      handler,
      shouldRetry: vi.fn(async (_error, attempt) => attempt === 1),
      retryDelayMs: vi.fn(async () => 0),
      onRetry,
      onError,
    });

    await processor.handle(
      createEvent(createIncomingMessage("1", "42"), {
        deliverError: async (error) => {
          deliveredErrors.push(error);
        },
      }),
    );

    expect(handler.handle).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(deliveredErrors).toHaveLength(1);
  });

  it("runs deferred delivery actions after the response is sent", async () => {
    const afterDeliveryAction = vi.fn(async () => {});
    const deliver = vi.fn(async () => {});
    const processor = createMessageProcessor({
      handler: {
        handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => ({
          conversation: message.conversation,
          text: "reply",
          deliveryAction: "restart",
        })),
      },
      afterDeliveryAction,
    });

    await processor.handle(
      createEvent(createIncomingMessage("1", "42"), {
        deliver,
      }),
    );

    expect(deliver).toHaveBeenCalledOnce();
    expect(afterDeliveryAction).toHaveBeenCalledWith(
      "restart",
      expect.objectContaining({
        message: expect.objectContaining({ messageId: "1" }),
      }),
    );
  });
});

function createEvent(
  message: IncomingMessage,
  overrides: Partial<{
    deliver: (message: OutgoingMessage) => Promise<void>;
    deliverError: (error: unknown) => Promise<void>;
    runWithProcessing: <T>(operation: () => Promise<T>) => Promise<T>;
  }> = {},
) {
  return {
    message,
    deliver: overrides.deliver ?? vi.fn(async () => {}),
    deliverError: overrides.deliverError,
    runWithProcessing:
      overrides.runWithProcessing ??
      (async <T>(operation: () => Promise<T>): Promise<T> => operation()),
  };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createIncomingMessage(messageId: string, externalId: string): IncomingMessage {
  return {
    botId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId,
    },
    messageId,
    correlationId: `corr-${messageId}`,
    userId: "7",
    text: `message-${messageId}`,
    receivedAt: "2026-04-05T00:00:00.000Z",
  };
}
