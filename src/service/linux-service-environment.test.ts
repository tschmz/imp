import { describe, expect, it } from "vitest";
import { renderLinuxServiceEnvironment } from "./linux-service-environment.js";

describe("linux service environment", () => {
  it("renders an empty environment file when no explicit variables are configured", async () => {
    const content = await renderLinuxServiceEnvironment();

    expect(content).toBe("\n");
  });

  it("includes explicit service environment variables", async () => {
    const content = await renderLinuxServiceEnvironment({
      env: {
        OPENAI_API_KEY: "sk-test",
      },
    });

    expect(content).toBe('OPENAI_API_KEY="sk-test"\n');
  });
});
