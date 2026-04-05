import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, OutgoingMessage } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import { createTelegramTransport } from "./telegram-transport.js";

describe("createTelegramTransport", () => {
  it("forwards a private text message from an allowed user", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = vi.fn<(message: IncomingMessage) => Promise<OutgoingMessage>>().mockResolvedValue({
      conversation: {
        transport: "telegram",
        externalId: "42",
      },
      text: "pong",
    });

    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
      logger,
    );

    await transport.start({ handle: handler });
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "ping" },
    });

    expect(handler).toHaveBeenCalledWith({
      conversation: {
        transport: "telegram",
        externalId: "42",
      },
      botId: "private-telegram",
      messageId: "99",
      correlationId: expect.any(String),
      userId: "7",
      text: "ping",
      receivedAt: expect.any(String),
    });
    expect(bot.reply).toHaveBeenCalledWith("pong");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("ignores a private text message from a disallowed user", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = vi.fn<(message: IncomingMessage) => Promise<OutgoingMessage>>();

    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
      logger,
    );

    await transport.start({ handle: handler });
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 8 },
      message: { message_id: 99, text: "ping" },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(bot.reply).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("replies with a stable error message when handling fails", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = vi
      .fn<(message: IncomingMessage) => Promise<OutgoingMessage>>()
      .mockRejectedValue(new Error("boom"));

    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
      logger,
    );

    await transport.start({ handle: handler });
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "ping" },
    });

    expect(bot.reply).toHaveBeenCalledWith(
      "Sorry, something went wrong while processing your message.",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "failed to handle telegram message",
      expect.objectContaining({
        botId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
        durationMs: expect.any(Number),
        errorType: "Error",
      }),
      expect.any(Error),
    );
  });
});

function createMockLogger(): Logger {
  return {
    debug: vi.fn(async () => {}),
    info: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
  };
}

function createFakeBot(): {
  api: { getMe(): Promise<unknown> };
  on(
    filter: "message:text",
    handler: (ctx: {
      chat?: { id: number; type: string };
      message?: { message_id: number; text: string };
      from?: { id: number };
      reply(text: string): Promise<unknown>;
    }) => Promise<void>,
  ): void;
  start(): Promise<void>;
  emitTextMessage(input: {
    chat: { id: number; type: string };
    from: { id: number };
    message: { message_id: number; text: string };
  }): Promise<void>;
  reply: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
} {
  let onTextMessage:
    | ((ctx: {
        chat?: { id: number; type: string };
        message?: { message_id: number; text: string };
        from?: { id: number };
        reply(text: string): Promise<unknown>;
      }) => Promise<void>)
    | undefined;

  const reply = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();

  return {
    api: {
      getMe: vi.fn(async () => ({ username: "test_bot" })),
    },
    on(_filter, handler) {
      onTextMessage = handler;
    },
    async start() {},
    async emitTextMessage(input) {
      if (!onTextMessage) {
        throw new Error("message handler was not registered");
      }

      await onTextMessage({
        ...input,
        reply,
      });
    },
    reply,
  };
}
