import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, OutgoingMessage } from "../../domain/message.js";
import { createTelegramTransport } from "./telegram-transport.js";

describe("createTelegramTransport", () => {
  it("forwards a private text message from an allowed user", async () => {
    const bot = createFakeBot();
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
      messageId: "99",
      userId: "7",
      text: "ping",
      receivedAt: expect.any(String),
    });
    expect(bot.reply).toHaveBeenCalledWith("pong");
  });

  it("ignores a private text message from a disallowed user", async () => {
    const bot = createFakeBot();
    const handler = vi.fn<(message: IncomingMessage) => Promise<OutgoingMessage>>();

    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
    );

    await transport.start({ handle: handler });
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 8 },
      message: { message_id: 99, text: "ping" },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(bot.reply).not.toHaveBeenCalled();
  });

  it("replies with a stable error message when handling fails", async () => {
    const bot = createFakeBot();
    const handler = vi
      .fn<(message: IncomingMessage) => Promise<OutgoingMessage>>()
      .mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
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

    errorSpy.mockRestore();
  });
});

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
