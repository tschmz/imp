import { describe, expect, it } from "vitest";
import { helpCommandHandler } from "./help-command.js";
import { createCommandContext, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("helpCommandHandler", () => {
  it("returns supported command help text", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("help"),
      dependencies: createDependencies({}),
    });

    const response = await helpCommandHandler.handle(context);

    expect(helpCommandHandler.canHandle("help")).toBe(true);
    expect(response?.text).toContain("**Commands**");
    expect(response?.text).toContain("Common:");
    expect(response?.text).toContain("`/new [title]` - Start a new session");
    expect(response?.text).toContain("`/fork [title]` - Fork the current session");
    expect(response?.text).toContain("`/reset` - Reset current session messages");
    expect(response?.text).toContain("`/delete` - Delete the current session");
    expect(response?.text).toContain("`/previous` - Resume the previous session");
    expect(response?.text).toContain("Context:");
    expect(response?.text).toContain("`/agent [id]` - Show or change the agent");
    expect(response?.text).toContain("Diagnostics:");
    expect(response?.text).toContain("`/logs [lines]` - Show recent endpoint logs");
  });
});
