import { describe, expect, it } from "vitest";
import { classifyModelProviderFailure } from "./processing-error.js";

describe("classifyModelProviderFailure", () => {
  it("classifies terminated provider streams as timeouts", () => {
    expect(classifyModelProviderFailure("terminated")).toBe("timeout");
  });
});
