import { describe, expect, it, vi } from "vitest";
import { logsCommandHandler } from "./logs-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("logsCommandHandler", () => {
  it("returns requested log lines", async () => {
    const readRecentLogLines = vi.fn(async () => ['{"level":"info","message":"ok"}']);
    const context = createCommandContext({
      message: createIncomingMessage("logs", "5"),
      dependencies: createDependencies({}),
      readRecentLogLines,
    });

    const response = await logsCommandHandler.handle(context);

    expect(logsCommandHandler.canHandle("logs")).toBe(true);
    expect(readRecentLogLines).toHaveBeenCalledWith("/tmp/private-telegram.log", 5, undefined, "private-telegram");
    expect(response?.text).toContain('{"level":"info","message":"ok"}');
  });
});
