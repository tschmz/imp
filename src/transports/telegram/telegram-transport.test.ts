import { describe, expect, it, vi } from "vitest";
import { inboundCommandMenu } from "../../application/commands/registry.js";
import type { IncomingMessage, OutgoingMessage } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import { createTelegramTransport } from "./telegram-transport.js";

describe("createTelegramTransport", () => {
  it("registers the new command on startup", async () => {
    const bot = createFakeBot();
    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
    );

    await transport.start({
      handle: vi.fn(async () => {}),
    });

    expect(bot.api.setMyCommands).toHaveBeenCalledWith(inboundCommandMenu);
  });

  it("forwards a validated inbound event from an allowed private text message", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    let capturedEvent:
      | Parameters<{
          handle(event: {
            message: IncomingMessage;
            deliver(message: OutgoingMessage): Promise<void>;
            runWithProcessing<T>(operation: () => Promise<T>): Promise<T>;
          }): Promise<void>;
        }["handle"]>[0]
      | undefined;
    const handler = {
      handle: vi.fn(async (event) => {
        capturedEvent = event;
        await event.runWithProcessing(async () => {
          await event.deliver({
            conversation: event.message.conversation,
            text: "pong",
          });
        });
      }),
    };

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

    await transport.start(handler);
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "ping" },
    });

    expect(capturedEvent?.message).toEqual({
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
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(bot.reply).toHaveBeenCalledWith("pong", {
      parse_mode: "HTML",
    });
    expect(bot.api.sendChatAction).toHaveBeenCalledWith(42, "typing");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("marks /new as a reset command for the application layer", async () => {
    const bot = createFakeBot();
    let capturedMessage: IncomingMessage | undefined;
    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
    );

    await transport.start({
      handle: vi.fn(async (event) => {
        capturedMessage = event.message;
      }),
    });
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "/new" },
    });

    expect(capturedMessage?.command).toBe("new");
  });

  it("captures command arguments for /restore", async () => {
    const bot = createFakeBot();
    let capturedMessage: IncomingMessage | undefined;
    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
    );

    await transport.start({
      handle: vi.fn(async (event) => {
        capturedMessage = event.message;
      }),
    });
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "/restore@test_bot 2" },
    });

    expect(capturedMessage?.command).toBe("restore");
    expect(capturedMessage?.commandArgs).toBe("2");
  });

  it("ignores commands addressed to a different Telegram bot username", async () => {
    const bot = createFakeBot();
    let capturedMessage: IncomingMessage | undefined;
    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
    );

    await transport.start({
      handle: vi.fn(async (event) => {
        capturedMessage = event.message;
      }),
    });
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "/new@other_bot" },
    });

    expect(capturedMessage?.command).toBeUndefined();
  });

  it("ignores a private text message from a disallowed user", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = {
      handle: vi.fn(async () => {}),
    };

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

    await transport.start(handler);
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 8 },
      message: { message_id: 99, text: "ping" },
    });

    expect(handler.handle).not.toHaveBeenCalled();
    expect(bot.reply).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("renders long telegram replies through the delivery hook", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = {
      handle: vi.fn(async (event) => {
        await event.runWithProcessing(async () => {
          await event.deliver({
            conversation: {
              transport: "telegram",
              externalId: "42",
            },
            text: "x".repeat(5000),
          });
        });
      }),
    };

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

    await transport.start(handler);
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "ping" },
    });

    expect(bot.reply).toHaveBeenCalledTimes(2);
    expect(bot.reply).toHaveBeenNthCalledWith(1, "x".repeat(4096), { parse_mode: "HTML" });
    expect(bot.reply).toHaveBeenNthCalledWith(2, "x".repeat(904), { parse_mode: "HTML" });
  });

  it("replies with a stable error message through the error delivery hook", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = {
      handle: vi.fn(async (event) => {
        await event.deliverError?.(new Error("boom"));
      }),
    };

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

    await transport.start(handler);
    await bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "ping" },
    });
    expect(bot.reply).toHaveBeenCalledWith("Sorry, something went wrong while processing your message.");
    expect(logger.debug).toHaveBeenCalledWith(
      "sending telegram processing error response",
      expect.objectContaining({
        botId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
      }),
    );
  });

  it("keeps sending typing status while a reply is still being generated", async () => {
    vi.useFakeTimers();
    try {
      const bot = createFakeBot();
      const logger = createMockLogger();
      let resolveOperation: (() => void) | undefined;
      const handler = {
        handle: vi.fn(async (event) => {
          await event.runWithProcessing(
            () =>
              new Promise<void>((resolve) => {
                resolveOperation = resolve;
              }),
          );
        }),
      };

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

      await transport.start(handler);
      const pendingMessage = bot.emitTextMessage({
        chat: { id: 42, type: "private" },
        from: { id: 7 },
        message: { message_id: 99, text: "ping" },
      });

      await Promise.resolve();
      expect(bot.api.sendChatAction).toHaveBeenCalledTimes(1);
      expect(bot.api.sendChatAction).toHaveBeenLastCalledWith(42, "typing");

      await vi.advanceTimersByTimeAsync(4000);
      expect(bot.api.sendChatAction).toHaveBeenCalledTimes(2);
      expect(bot.api.sendChatAction).toHaveBeenLastCalledWith(42, "typing");

      resolveOperation?.();

      await pendingMessage;
      await vi.advanceTimersByTimeAsync(4000);
      expect(bot.api.sendChatAction).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
  api: {
    getMe(): Promise<{ username: string }>;
    sendChatAction(chatId: number, action: "typing"): Promise<unknown>;
    setMyCommands(commands: ReadonlyArray<{ command: string; description: string }>): Promise<unknown>;
  };
  on(
    filter: "message:text",
    handler: (ctx: {
      chat?: { id: number; type: string };
      message?: { message_id: number; text: string };
      from?: { id: number };
      reply(
        text: string,
        other?: {
          parse_mode?: "HTML" | "MarkdownV2";
        },
      ): Promise<unknown>;
    }) => Promise<void>,
  ): void;
  start(): Promise<void>;
  stop(): void;
  emitTextMessage(input: {
    chat: { id: number; type: string };
    from: { id: number };
    message: { message_id: number; text: string };
  }): Promise<void>;
  reply: ReturnType<
    typeof vi.fn<(text: string, other?: { parse_mode?: "HTML" | "MarkdownV2" }) => Promise<void>>
  >;
} {
  let onTextMessage:
    | ((ctx: {
        chat?: { id: number; type: string };
        message?: { message_id: number; text: string };
        from?: { id: number };
        reply(
          text: string,
          other?: {
            parse_mode?: "HTML" | "MarkdownV2";
          },
        ): Promise<unknown>;
      }) => Promise<void>)
    | undefined;

  const reply = vi
    .fn<(text: string, other?: { parse_mode?: "HTML" | "MarkdownV2" }) => Promise<void>>()
    .mockResolvedValue();

  return {
    api: {
      getMe: vi.fn(async () => ({ username: "test_bot" })),
      sendChatAction: vi.fn(async () => ({})),
      setMyCommands: vi.fn(async () => ({})),
    },
    on(_filter, handler) {
      onTextMessage = handler;
    },
    async start() {},
    stop() {},
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
