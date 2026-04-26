import { describe, expect, it, vi } from "vitest";
import { parseInboundCommand } from "./commands/parse-inbound-command.js";
import { priorityInboundCommands } from "./commands/priority-inbound-commands.js";
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

    await tick();

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

  it("keeps endpoint queues isolated for the same transport/external conversation id", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(`${message.messageId}:${message.endpointId}`);
        await new Promise<void>((resolve) => {
          releases.set(message.messageId, resolve);
        });
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

    const first = processor.handle(createEvent(createIncomingMessage("1", "shared-chat", "endpoint-a")));
    const second = processor.handle(createEvent(createIncomingMessage("2", "shared-chat", "endpoint-b")));
    const third = processor.handle(createEvent(createIncomingMessage("3", "shared-chat", "endpoint-a")));

    await tick();

    expect(starts).toEqual(["1:endpoint-a", "2:endpoint-b"]);

    releases.get("2")?.();
    await second;
    expect(starts).toEqual(["1:endpoint-a", "2:endpoint-b"]);

    releases.get("1")?.();
    await tick();
    expect(starts).toEqual(["1:endpoint-a", "2:endpoint-b", "3:endpoint-a"]);

    releases.get("3")?.();
    await Promise.all([first, third]);
  });

  it("preserves conversation order when prepareMessage is async", async () => {
    const prepareStarts: string[] = [];
    const starts: string[] = [];
    let releaseFirstPrepare: (() => void) | undefined;
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(message.messageId);
        return {
          conversation: message.conversation,
          text: `reply:${message.messageId}`,
        };
      }),
    };

    const processor = createMessageProcessor({
      handler,
      prepareEvent: (event) => ({
        ...event,
        message: {
          ...event.message,
          conversation: {
            ...event.message.conversation,
            sessionId: "session-1",
          },
        },
      }),
    });

    const first = processor.handle(
      createEvent(createIncomingMessage("1", "42"), {
        deliverProgress: vi.fn(async () => {}),
        prepareMessage: async (message) => {
          prepareStarts.push(message.messageId);
          await new Promise<void>((resolve) => {
            releaseFirstPrepare = resolve;
          });
          return {
            ...message,
            text: "prepared-1",
          };
        },
      }),
    );
    await tick();
    const second = processor.handle(
      createEvent(createIncomingMessage("2", "42"), {
        deliverProgress: vi.fn(async () => {}),
        prepareMessage: async (message) => {
          prepareStarts.push(message.messageId);
          return {
            ...message,
            text: "prepared-2",
          };
        },
      }),
    );

    await tick();
    await tick();

    expect(prepareStarts).toEqual(["1"]);
    expect(starts).toEqual([]);

    releaseFirstPrepare?.();
    await Promise.all([first, second]);

    expect(prepareStarts).toEqual(["1", "2"]);
    expect(starts).toEqual(["1", "2"]);
    expect(handler.handle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ messageId: "1", text: "prepared-1" }),
      expect.objectContaining({ deliverProgress: expect.any(Function) }),
    );
    expect(handler.handle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageId: "2", text: "prepared-2" }),
      expect.objectContaining({ deliverProgress: expect.any(Function) }),
    );
  });

  it("only wires progress delivery when the transport exposes it", async () => {
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => ({
        conversation: message.conversation,
        text: `reply:${message.messageId}`,
      })),
    };

    const processor = createMessageProcessor({
      handler,
    });

    const deliverProgress = vi.fn(async () => {});

    await processor.handle(createEvent(createIncomingMessage("1", "42"), { deliverProgress }));
    await processor.handle(createEvent(createIncomingMessage("2", "42")));

    expect(handler.handle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ messageId: "1" }),
      expect.objectContaining({ deliverProgress: expect.any(Function) }),
    );
    expect(handler.handle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ messageId: "2" }),
      undefined,
    );
  });

  it("serializes messages with the same shared session id across surfaces", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(`${message.messageId}:${message.conversation.transport}`);
        await new Promise<void>((resolve) => {
          releases.set(message.messageId, resolve);
        });
        return {
          conversation: message.conversation,
          text: `reply:${message.messageId}`,
        };
      }),
    };

    const processor = createMessageProcessor({
      handler,
      maxParallel: 2,
      prepareEvent: (event) => ({
        ...event,
        message: {
          ...event.message,
          conversation: {
            ...event.message.conversation,
            sessionId: "shared-session",
          },
        },
      }),
    });

    const first = processor.handle(createEvent(createIncomingMessage("1", "42")));
    const second = processor.handle(
      createEvent({
        ...createIncomingMessage("2", "plugin-chat"),
        conversation: {
          transport: "file",
          externalId: "plugin-chat",
        },
      }),
    );

    await tick();

    expect(starts).toEqual(["1:telegram"]);
    releases.get("1")?.();
    await tick();
    expect(starts).toEqual(["1:telegram", "2:file"]);

    releases.get("2")?.();
    await Promise.all([first, second]);
  });

  it("never exceeds maxParallel while handing permits to waiting conversations", async () => {
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

    const first = processor.handle(createEvent(createIncomingMessage("1", "101")));
    const second = processor.handle(createEvent(createIncomingMessage("2", "102")));
    const third = processor.handle(createEvent(createIncomingMessage("3", "103")));

    await tick();

    expect(starts).toEqual(["1", "2"]);
    expect(maxActive).toBe(2);

    releases.get("1")?.();
    await tick();

    expect(starts).toEqual(["1", "2", "3"]);
    expect(maxActive).toBe(2);

    const fourth = processor.handle(createEvent(createIncomingMessage("4", "104")));
    await tick();

    expect(starts).toEqual(["1", "2", "3"]);
    expect(maxActive).toBe(2);

    releases.get("2")?.();
    await tick();

    expect(starts).toEqual(["1", "2", "3", "4"]);
    expect(maxActive).toBe(2);

    releases.get("3")?.();
    releases.get("4")?.();
    await Promise.all([first, second, third, fourth]);
  });

  it("lets /new run immediately and routes later messages to a new session queue", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(`${message.messageId}:${"sessionId" in message.conversation ? message.conversation.sessionId : "chat"}`);
        if (!message.command) {
          await new Promise<void>((resolve) => {
            releases.set(message.messageId, resolve);
          });
        }

        return {
          conversation: {
            transport: message.conversation.transport,
            externalId: message.conversation.externalId,
          },
          text: `reply:${message.messageId}`,
        };
      }),
    };

    let activeSessionId = "session-1";
    const processor = createMessageProcessor({
      handler,
      prepareEvent: (event) => {
        if (event.message.command === "new") {
          activeSessionId = "session-2";
          return event;
        }

        return {
          ...event,
          message: {
            ...event.message,
            conversation: {
              ...event.message.conversation,
              sessionId: activeSessionId,
            },
          },
        };
      },
    });

    const first = processor.handle(createEvent(createIncomingMessage("1", "42")));
    await tick();
    const reset = processor.handle(
      createEvent({
        ...createIncomingMessage("2", "42"),
        text: "/new",
        command: "new",
      }),
    );
    const third = processor.handle(createEvent(createIncomingMessage("3", "42")));

    await tick();
    await tick();

    expect(starts).toEqual(["1:session-1", "2:chat", "3:session-2"]);

    releases.get("3")?.();
    await third;

    releases.get("1")?.();
    await Promise.all([first, reset]);
  });

  it("lets /new bypass the active session queue even when command metadata is missing", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(
          `${message.messageId}:${message.command ?? ("sessionId" in message.conversation ? message.conversation.sessionId : "chat")}`,
        );
        if (!message.command) {
          await new Promise<void>((resolve) => {
            releases.set(message.messageId, resolve);
          });
        }

        return {
          conversation: {
            transport: message.conversation.transport,
            externalId: message.conversation.externalId,
          },
          text: `reply:${message.messageId}`,
        };
      }),
    };

    let activeSessionId = "session-1";
    const processor = createMessageProcessor({
      handler,
      prepareEvent: (event) => {
        const command = event.message.command
          ? { command: event.message.command, ...(event.message.commandArgs ? { commandArgs: event.message.commandArgs } : {}) }
          : parseInboundCommand(event.message.text, {
              allowedCommands: priorityInboundCommands,
            });
        if (command) {
          if (command.command === "new") {
            activeSessionId = "session-2";
          }

          return {
            ...event,
            message: {
              ...event.message,
              ...command,
            },
          };
        }

        return {
          ...event,
          message: {
            ...event.message,
            conversation: {
              ...event.message.conversation,
              sessionId: activeSessionId,
            },
          },
        };
      },
    });

    const first = processor.handle(createEvent(createIncomingMessage("1", "42")));
    await tick();
    const reset = processor.handle(
      createEvent({
        ...createIncomingMessage("2", "42"),
        text: "/new",
      }),
    );
    const third = processor.handle(createEvent(createIncomingMessage("3", "42")));

    await tick();
    await tick();

    expect(starts).toEqual(["1:session-1", "2:new", "3:session-2"]);

    releases.get("3")?.();
    await third;

    releases.get("1")?.();
    await Promise.all([first, reset]);
  });

  it("lets /resume bypass the active session queue even when command metadata is missing", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(
          `${message.messageId}:${message.command ?? ("sessionId" in message.conversation ? message.conversation.sessionId : "chat")}`,
        );
        if (!message.command) {
          await new Promise<void>((resolve) => {
            releases.set(message.messageId, resolve);
          });
        }

        return {
          conversation: {
            transport: message.conversation.transport,
            externalId: message.conversation.externalId,
          },
          text: `reply:${message.messageId}`,
        };
      }),
    };

    let activeSessionId = "session-1";
    const processor = createMessageProcessor({
      handler,
      prepareEvent: (event) => {
        const command = event.message.command
          ? { command: event.message.command, ...(event.message.commandArgs ? { commandArgs: event.message.commandArgs } : {}) }
          : parseInboundCommand(event.message.text, {
              allowedCommands: priorityInboundCommands,
            });
        if (command) {
          if (command.command === "resume") {
            activeSessionId = "session-restored";
          }

          return {
            ...event,
            message: {
              ...event.message,
              ...command,
            },
          };
        }

        return {
          ...event,
          message: {
            ...event.message,
            conversation: {
              ...event.message.conversation,
              sessionId: activeSessionId,
            },
          },
        };
      },
    });

    const first = processor.handle(createEvent(createIncomingMessage("1", "42")));
    await tick();
    const resume = processor.handle(
      createEvent({
        ...createIncomingMessage("2", "42"),
        text: "/resume 1",
      }),
    );
    const third = processor.handle(createEvent(createIncomingMessage("3", "42")));

    await tick();
    await tick();

    expect(starts).toEqual(["1:session-1", "2:resume", "3:session-restored"]);

    releases.get("3")?.();
    await third;

    releases.get("1")?.();
    await Promise.all([first, resume]);
  });

  it("lets rename bypass the active session queue as a lightweight session metadata change", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(
          `${message.messageId}:${message.command ?? ("sessionId" in message.conversation ? message.conversation.sessionId : "chat")}`,
        );
        if (message.messageId !== "3") {
          await new Promise<void>((resolve) => {
            releases.set(message.messageId, resolve);
          });
        }

        return {
          conversation: message.conversation,
          text: `reply:${message.messageId}`,
        };
      }),
    };

    const processor = createMessageProcessor({
      handler,
      maxParallel: 2,
      prepareEvent: (event) => ({
        ...event,
        message: {
          ...event.message,
          conversation: {
            ...event.message.conversation,
            sessionId: "session-1",
          },
        },
      }),
    });

    const first = processor.handle(createEvent(createIncomingMessage("1", "42")));
    await tick();
    const rename = processor.handle(
      createEvent({
        ...createIncomingMessage("2", "42"),
        text: "/rename renamed",
        command: "rename",
        commandArgs: "renamed",
      }),
    );
    const third = processor.handle(createEvent(createIncomingMessage("3", "42")));

    await tick();
    await tick();

    expect(starts).toEqual(["1:session-1", "2:rename"]);

    releases.get("1")?.();
    await tick();
    expect(starts).toEqual(["1:session-1", "2:rename", "3:session-1"]);

    releases.get("2")?.();
    await Promise.all([first, rename, third]);
  });

  it("lets /agent bypass the active session queue as a lightweight surface switch", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    const handler = {
      handle: vi.fn(async (message: IncomingMessage): Promise<OutgoingMessage> => {
        starts.push(
          `${message.messageId}:${message.command ?? ("sessionId" in message.conversation ? message.conversation.sessionId : "chat")}`,
        );
        if (!message.command) {
          await new Promise<void>((resolve) => {
            releases.set(message.messageId, resolve);
          });
        }

        return {
          conversation: {
            transport: message.conversation.transport,
            externalId: message.conversation.externalId,
          },
          text: `reply:${message.messageId}`,
        };
      }),
    };

    const processor = createMessageProcessor({
      handler,
      prepareEvent: (event) => {
        const command = event.message.command
          ? { command: event.message.command, ...(event.message.commandArgs ? { commandArgs: event.message.commandArgs } : {}) }
          : parseInboundCommand(event.message.text, {
              allowedCommands: priorityInboundCommands,
            });
        if (command) {
          return {
            ...event,
            message: {
              ...event.message,
              ...command,
            },
          };
        }

        return {
          ...event,
          message: {
            ...event.message,
            conversation: {
              ...event.message.conversation,
              sessionId: "session-1",
            },
          },
        };
      },
    });

    const first = processor.handle(createEvent(createIncomingMessage("1", "42")));
    await tick();
    const agent = processor.handle(
      createEvent({
        ...createIncomingMessage("2", "42"),
        text: "/agent ops",
      }),
    );
    const third = processor.handle(createEvent(createIncomingMessage("3", "42")));

    await tick();
    await tick();

    expect(starts).toEqual(["1:session-1", "2:agent"]);

    releases.get("1")?.();
    await tick();
    expect(starts).toEqual(["1:session-1", "2:agent", "3:session-1"]);

    releases.get("3")?.();
    await Promise.all([first, agent, third]);
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

  it.each([NaN, -1, Number.POSITIVE_INFINITY])(
    "treats invalid retry delay %p as immediate retry without throwing",
    async (invalidDelay) => {
      const handler = {
        handle: vi
          .fn<(message: IncomingMessage) => Promise<OutgoingMessage>>()
          .mockRejectedValueOnce(new Error("transient"))
          .mockResolvedValue({
            conversation: createIncomingMessage("1", "42").conversation,
            text: "ok",
          }),
      };
      const onRetry = vi.fn(async () => {});
      const onError = vi.fn(async () => {});
      const processor = createMessageProcessor({
        handler,
        shouldRetry: vi.fn(async (_error, attempt) => attempt === 1),
        retryDelayMs: vi.fn(async () => invalidDelay),
        onRetry,
        onError,
      });

      await expect(processor.handle(createEvent(createIncomingMessage("1", "42")))).resolves.toBeUndefined();

      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it("caps retry delay to keep the retry flow deterministic", async () => {
    vi.useFakeTimers();
    try {
      const handler = {
        handle: vi
          .fn<(message: IncomingMessage) => Promise<OutgoingMessage>>()
          .mockRejectedValueOnce(new Error("transient"))
          .mockResolvedValue({
            conversation: createIncomingMessage("1", "42").conversation,
            text: "ok",
          }),
      };
      const processor = createMessageProcessor({
        handler,
        shouldRetry: vi.fn(async (_error, attempt) => attempt === 1),
        retryDelayMs: vi.fn(async () => 60_000),
      });

      const processing = processor.handle(createEvent(createIncomingMessage("1", "42")));

      await vi.advanceTimersByTimeAsync(29_999);
      expect(handler.handle).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await processing;

      expect(handler.handle).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
    deliverProgress: (message: OutgoingMessage) => Promise<void>;
    deliverError: (error: unknown) => Promise<void>;
    prepareMessage: (message: IncomingMessage) => Promise<IncomingMessage> | IncomingMessage;
    runWithProcessing: <T>(operation: () => Promise<T>) => Promise<T>;
  }> = {},
) {
  return {
    message,
    prepareMessage: overrides.prepareMessage,
    deliver: overrides.deliver ?? vi.fn(async () => {}),
    ...(overrides.deliverProgress ? { deliverProgress: overrides.deliverProgress } : {}),
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

function createIncomingMessage(messageId: string, externalId: string, endpointId = "private-telegram"): IncomingMessage {
  return {
    endpointId,
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
