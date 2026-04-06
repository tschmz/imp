import { describe, expect, it, vi } from "vitest";
import { newCommandHandler } from "./new-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("newCommandHandler", () => {
  it("resets and recreates conversation state", async () => {
    const reset = vi.fn(async () => {});
    const put = vi.fn(async () => {});
    const context = createCommandContext({
      message: createIncomingMessage("new"),
      dependencies: createDependencies({
        conversationStore: {
          get: async () => undefined,
          put,
          listBackups: async () => [],
          restore: async () => false,
          reset,
        },
      }),
    });

    const response = await newCommandHandler.handle(context);

    expect(newCommandHandler.canHandle("new")).toBe(true);
    expect(reset).toHaveBeenCalledWith(context.message.conversation);
    expect(put).toHaveBeenCalled();
    expect(response?.text).toContain("Started a fresh conversation");
  });
});
