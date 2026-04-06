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
    expect(response?.text).toContain("/help Show this help message.");
    expect(response?.text).toContain("/new Start a fresh session.");
    expect(response?.text).toContain("/restore <n> Switch to session number <n> from /history.");
    expect(response?.text).toContain("/logs Show recent daemon log lines for this bot.");
  });
});
