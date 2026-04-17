import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboundCommandMenu } from "../../application/commands/registry.js";
import type { IncomingMessage, OutgoingMessage } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import { createDeliveryRouter } from "../delivery-router.js";
import { createTelegramTransport } from "./telegram-transport.js";
import type { VoiceTranscriber } from "./openai-voice-transcriber.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

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
      endpointId: "private-telegram",
      messageId: "99",
      correlationId: expect.any(String),
      userId: "7",
      text: "ping",
      receivedAt: expect.any(String),
      source: {
        kind: "text",
      },
    });
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(bot.reply).toHaveBeenCalledWith("pong", {
      parse_mode: "HTML",
    });
    expect(bot.api.sendChatAction).toHaveBeenCalledWith(42, "typing");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("registers endpoint delivery through the shared delivery router", async () => {
    const bot = createFakeBot();
    const deliveryRouter = createDeliveryRouter();
    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
      },
      bot,
      undefined,
      {},
      {
        deliveryRouter,
      },
    );

    await transport.start({
      handle: vi.fn(async () => {}),
    });

    await deliveryRouter.deliver({
      endpointId: "private-telegram",
      target: {
        conversationId: "42",
      },
      message: {
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        text: "hello",
      },
    });

    expect(bot.api.sendMessage).toHaveBeenCalledWith("42", "hello", {
      parse_mode: "HTML",
    });

    await transport.stop?.();
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

  it("treats /start as an alias for /new", async () => {
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
      message: { message_id: 99, text: "/start" },
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

  it("detects Telegram commands from bot_command entities", async () => {
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
      message: {
        message_id: 99,
        text: "/restore@test_bot 2",
        entities: [{ type: "bot_command", offset: 0, length: 17 }],
      },
    });

    expect(capturedMessage?.command).toBe("restore");
    expect(capturedMessage?.commandArgs).toBe("2");
  });

  it("does not block later telegram updates while a prior handler call is still running", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const starts: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const handler = {
      handle: vi.fn(async (event) => {
        starts.push(event.message.messageId);
        if (event.message.messageId === "99") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
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

    const first = bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 99, text: "long run" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = bot.emitTextMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: { message_id: 100, text: "/new" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toEqual(["99", "100"]);

    releaseFirst?.();
    await Promise.all([first, second]);
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
        endpointId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
      }),
    );
  });

  it("logs terminal telegram processing failures without leaking unhandled rejections", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = {
      handle: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error);
    };

    bot.reply.mockRejectedValueOnce(new Error("reply failed"));

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

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      await transport.start(handler);
      await bot.emitTextMessage({
        chat: { id: 42, type: "private" },
        from: { id: 7 },
        message: { message_id: 99, text: "ping" },
      });
      await waitForAsync(
        () =>
          ((logger.error as unknown as { mock?: { calls: unknown[][] } }).mock?.calls.length ?? 0) === 2,
      );
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toEqual([]);
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      "failed to process telegram message",
      expect.objectContaining({
        endpointId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
        errorType: "Error",
      }),
      expect.objectContaining({ message: "boom" }),
    );
    expect(logger.error).toHaveBeenNthCalledWith(
      2,
      "telegram message processing terminated after an unhandled failure",
      expect.objectContaining({
        endpointId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
        errorType: "Error",
      }),
      expect.objectContaining({ message: "reply failed" }),
    );
  });

  it("swallows detached rejection chains when error delivery and terminal logging both fail", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const handler = {
      handle: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error);
    };

    logger.debug = vi.fn(async (message: string) => {
      if (message === "sending telegram processing error response") {
        throw new Error("debug failed");
      }
    });
    logger.error = vi.fn(async () => {
      throw new Error("log failed");
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

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      await transport.start(handler);
      await bot.emitTextMessage({
        chat: { id: 42, type: "private" },
        from: { id: 7 },
        message: { message_id: 99, text: "ping" },
      });
      await waitForAsync(
        () =>
          ((logger.error as unknown as { mock?: { calls: unknown[][] } }).mock?.calls.length ?? 0) === 2,
      );
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toEqual([]);
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      "failed to process telegram message",
      expect.objectContaining({
        endpointId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
        errorType: "Error",
      }),
      expect.objectContaining({ message: "boom" }),
    );
    expect(logger.error).toHaveBeenNthCalledWith(
      2,
      "telegram message processing terminated after an unhandled failure",
      expect.objectContaining({
        endpointId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
        errorType: "Error",
      }),
      expect.objectContaining({ message: "debug failed" }),
    );
    expect(bot.reply).not.toHaveBeenCalled();
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

  it("transcribes voice messages and shows the transcript before the agent reply", async () => {
    const bot = createFakeBot();
    const voiceTranscriber: VoiceTranscriber = {
      transcribe: vi.fn(async () => ({ text: "hello from voice" })),
    };
    let capturedMessage: IncomingMessage | undefined;
    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
        voice: {
          enabled: true,
          transcription: {
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
          },
        },
      },
      bot,
      undefined,
      {
        fetch: vi.fn<typeof fetch>(async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              "Content-Type": "audio/ogg",
            },
          }),
        ),
        voiceTranscriber,
      },
    );

    await transport.start({
      handle: vi.fn(async (event) => {
        capturedMessage = event.message;
        await event.runWithProcessing(async () => {
          await event.deliver({
            conversation: event.message.conversation,
            text: "agent reply",
          });
        });
      }),
    });
    await bot.emitVoiceMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: {
        message_id: 99,
        voice: {
          file_id: "voice-file",
          mime_type: "audio/ogg",
        },
      },
    });

    expect(capturedMessage?.text).toBe("hello from voice");
    expect(capturedMessage?.source).toEqual({
      kind: "telegram-voice-transcript",
      transcript: {
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
      },
    });
    expect(capturedMessage?.command).toBeUndefined();
    expect(bot.api.getFile).toHaveBeenCalledWith("voice-file");
    expect(bot.reply).toHaveBeenNthCalledWith(1, "<b>Transcript</b>\nhello from voice", {
      parse_mode: "HTML",
    });
    expect(bot.reply).toHaveBeenNthCalledWith(2, "agent reply", {
      parse_mode: "HTML",
    });
  });

  it("downloads telegram documents into the resolved conversation session and adds attachment context", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-telegram-doc-"));
    tempDirs.push(root);
    const bot = createFakeBot();
    bot.api.getFile = vi.fn(async () => ({ file_path: "documents/report.txt" }));
    const fetchImpl = vi.fn(async () => new Response("file contents", {
      headers: {
        "content-type": "text/plain",
      },
    }));
    let capturedEvent:
      | {
          message: IncomingMessage;
          prepareMessage?(message: IncomingMessage): Promise<IncomingMessage> | IncomingMessage;
        }
      | undefined;

    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
        document: {
          maxDownloadBytes: 1024,
        },
        paths: {
          conversationsDir: join(root, "endpoints", "private-telegram", "conversations"),
        },
      },
      bot,
      undefined,
      { fetch: fetchImpl },
    );

    await transport.start({
      handle: vi.fn(async (event) => {
        capturedEvent = event;
      }),
    });

    await bot.emitDocumentMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: {
        message_id: 100,
        caption: "Please inspect this report",
        document: {
          file_id: "doc-file",
          file_unique_id: "doc-unique",
          file_name: "report.txt",
          mime_type: "text/plain",
          file_size: 13,
        },
      },
    });

    await waitForAsync(() => capturedEvent !== undefined, 200);
    expect(capturedEvent?.prepareMessage).toBeTypeOf("function");
    const capturedMessage = await capturedEvent?.prepareMessage?.({
      ...capturedEvent.message,
      conversation: {
        ...capturedEvent.message.conversation,
        sessionId: "session-1",
      } as IncomingMessage["conversation"] & { sessionId: string },
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://api.telegram.org/file/bottelegram-token/documents/report.txt");
    expect(capturedMessage).toMatchObject({
      text: "Please inspect this report",
      source: {
        kind: "telegram-document",
        document: {
          fileId: "doc-file",
          fileUniqueId: "doc-unique",
          fileName: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 13,
        },
      },
    });
    const savedPath = capturedMessage?.source?.document?.savedPath;
    expect(savedPath).toBe(
      join(
        root,
        "endpoints",
        "private-telegram",
        "conversations",
        "telegram",
        "42",
        "sessions",
        "session-1",
        "attachments",
        "100-report.txt",
      ),
    );
    await expect(readFile(savedPath ?? "", "utf8")).resolves.toBe("file contents");
  });

  it("replies clearly when a telegram document exceeds the configured size limit", async () => {
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
        document: {
          maxDownloadBytes: 4,
        },
      },
      bot,
      logger,
    );

    await transport.start(handler);
    await bot.emitDocumentMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: {
        message_id: 101,
        document: {
          file_id: "doc-file",
          file_name: "large.txt",
          file_size: 5,
        },
      },
    });

    expect(handler.handle).not.toHaveBeenCalled();
    expect(bot.reply).toHaveBeenCalledWith(
      "Sorry, that document is too large. The current limit is 4 bytes.",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "telegram document exceeds configured download size limit",
      expect.objectContaining({
        endpointId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "101",
      }),
    );
  });

  it("replies clearly when voice messages are disabled", async () => {
    const bot = createFakeBot();
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
    );

    await transport.start(handler);
    await bot.emitVoiceMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: {
        message_id: 99,
        voice: {
          file_id: "voice-file",
        },
      },
    });

    expect(handler.handle).not.toHaveBeenCalled();
    expect(bot.reply).toHaveBeenCalledWith("Voice messages are not enabled for this endpoint.");
  });

  it("returns a stable reply when voice transcription fails", async () => {
    const bot = createFakeBot();
    const logger = createMockLogger();
    const voiceTranscriber: VoiceTranscriber = {
      transcribe: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const transport = createTelegramTransport(
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["7"],
        voice: {
          enabled: true,
          transcription: {
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
          },
        },
      },
      bot,
      logger,
      {
        fetch: vi.fn<typeof fetch>(async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
          }),
        ),
        voiceTranscriber,
      },
    );

    await transport.start({
      handle: vi.fn(async () => {}),
    });
    await bot.emitVoiceMessage({
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      message: {
        message_id: 99,
        voice: {
          file_id: "voice-file",
        },
      },
    });

    expect(bot.reply).toHaveBeenCalledWith("Sorry, I couldn't transcribe that voice message.");
    expect(logger.error).toHaveBeenCalledWith(
      "failed to transcribe telegram voice message",
      expect.objectContaining({
        endpointId: "private-telegram",
        transport: "telegram",
        conversationId: "42",
        messageId: "99",
      }),
      expect.objectContaining({ message: "boom" }),
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

async function waitForAsync(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error("condition was not met in time");
}

function createFakeBot(): {
  api: {
    getMe(): Promise<{ username: string }>;
    getFile(fileId: string): Promise<{ file_path?: string }>;
    sendMessage(chatId: number | string, text: string, other?: { parse_mode?: "HTML" | "MarkdownV2" }): Promise<unknown>;
    sendChatAction(chatId: number, action: "typing"): Promise<unknown>;
    setMyCommands(commands: ReadonlyArray<{ command: string; description: string }>): Promise<unknown>;
  };
  on(
    filter: "message" | "message:text",
    handler: (ctx: {
      chat?: { id: number; type: string };
      message?: {
        message_id: number;
        entities?: Array<{ type: string; offset: number; length: number }>;
        text?: string;
        voice?: {
          file_id: string;
          mime_type?: string;
        };
        document?: {
          file_id: string;
          file_unique_id?: string;
          file_name?: string;
          mime_type?: string;
          file_size?: number;
        };
        caption?: string;
      };
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
    message: {
      entities?: Array<{ type: string; offset: number; length: number }>;
      message_id: number;
      text: string;
    };
  }): Promise<void>;
  emitVoiceMessage(input: {
    chat: { id: number; type: string };
    from: { id: number };
    message: {
      message_id: number;
      voice: {
        file_id: string;
        mime_type?: string;
      };
    };
  }): Promise<void>;
  emitDocumentMessage(input: {
    chat: { id: number; type: string };
    from: { id: number };
    message: {
      message_id: number;
      caption?: string;
      document: {
        file_id: string;
        file_unique_id?: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
      };
    };
  }): Promise<void>;
  reply: ReturnType<
    typeof vi.fn<(text: string, other?: { parse_mode?: "HTML" | "MarkdownV2" }) => Promise<void>>
  >;
} {
  let onTextMessage:
    | ((ctx: {
        chat?: { id: number; type: string };
        message?: {
          message_id: number;
          entities?: Array<{ type: string; offset: number; length: number }>;
          text?: string;
          voice?: {
            file_id: string;
            mime_type?: string;
          };
          document?: {
            file_id: string;
            file_unique_id?: string;
            file_name?: string;
            mime_type?: string;
            file_size?: number;
          };
          caption?: string;
        };
        from?: { id: number };
        reply(
          text: string,
          other?: {
            parse_mode?: "HTML" | "MarkdownV2";
          },
        ): Promise<unknown>;
      }) => Promise<void>)
    | undefined;
  let onVoiceMessage = onTextMessage;

  const reply = vi
    .fn<(text: string, other?: { parse_mode?: "HTML" | "MarkdownV2" }) => Promise<void>>()
    .mockResolvedValue();

  return {
    api: {
      getMe: vi.fn(async () => ({ username: "test_bot" })),
      getFile: vi.fn(async () => ({ file_path: "voice/test.ogg" })),
      sendMessage: vi.fn(async () => ({})),
      sendChatAction: vi.fn(async () => ({})),
      setMyCommands: vi.fn(async () => ({})),
    },
    on(filter, handler) {
      if (filter === "message:text") {
        onTextMessage = handler;
        return;
      }

      if (filter === "message") {
        onVoiceMessage = handler;
      }
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
    async emitVoiceMessage(input) {
      if (!onVoiceMessage) {
        throw new Error("voice handler was not registered");
      }

      await onVoiceMessage({
        ...input,
        reply,
      });
    },
    async emitDocumentMessage(input) {
      if (!onVoiceMessage) {
        throw new Error("message handler was not registered");
      }

      await onVoiceMessage({
        ...input,
        reply,
      });
    },
    reply,
  };
}
