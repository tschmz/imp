import { describe, expect, it } from "vitest";
import { inboundCommandHandlers, inboundCommandMenu, inboundCommandNames } from "./registry.js";

describe("command registry", () => {
  it("exposes telegram menu entries that match handler metadata", () => {
    expect(inboundCommandMenu).toEqual(
      inboundCommandHandlers.map((handler) => ({
        command: handler.metadata.name,
        description: handler.metadata.description,
      })),
    );
  });

  it("keeps command handlers and command names in sync", () => {
    expect(inboundCommandNames).toEqual(
      new Set(inboundCommandHandlers.map((handler) => handler.metadata.name)),
    );

    for (const handler of inboundCommandHandlers) {
      expect(handler.canHandle(handler.metadata.name)).toBe(true);
    }
  });
});
