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
    expect(response?.text).toContain(
      "`/new [title]` - Start a new session. The previous one stays available in /history.",
    );
    expect(response?.text).toContain(
      "`/reset` - Reset messages in the current session while preserving its title and agent.",
    );
    expect(response?.text).toContain("Context:");
    expect(response?.text).toContain("`/agent [id]` - Show or change the session agent.");
    expect(response?.text).toContain("Diagnostics:");
    expect(response?.text).toContain("`/logs [lines]` - Show recent daemon log lines for this endpoint.");
  });
});
