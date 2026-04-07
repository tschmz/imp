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
    expect(response?.text).toContain("Sessions:");
    expect(response?.text).toContain("/new [title] Start a new session.");
    expect(response?.text).toContain("/reset Reset messages in the current session while preserving its title and agent.");
    expect(response?.text).toContain("Context:");
    expect(response?.text).toContain("Diagnostics:");
    expect(response?.text).toContain("/logs Show recent daemon log lines for this bot.");
  });
});
