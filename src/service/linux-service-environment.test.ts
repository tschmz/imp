import { describe, expect, it } from "vitest";
import { buildLinuxServicePath, renderLinuxServiceEnvironment } from "./linux-service-environment.js";

describe("linux service environment", () => {
  it("preserves current PATH entries and appends standard user/bin fallbacks", () => {
    const pathValue = buildLinuxServicePath({
      PATH: "/custom/bin:/usr/bin:/bin",
    });

    expect(pathValue).toContain("/custom/bin");
    expect(pathValue).toContain("${HOME}/.local/bin");
    expect(pathValue).toContain("${HOME}/bin");
    expect(pathValue).toContain("/usr/bin");
    expect(pathValue).toContain("/bin");
    expect(pathValue.split(":").filter((entry) => entry === "/usr/bin")).toHaveLength(1);
  });

  it("renders a systemd environment file with a quoted PATH", async () => {
    const content = await renderLinuxServiceEnvironment({
      pathEnv: {
        PATH: "/custom/bin:/usr/bin",
      },
    });

    expect(content).toBe(
      'PATH="/custom/bin:/usr/bin:${HOME}/.local/bin:${HOME}/bin:${HOME}/.npm-global/bin:${HOME}/.volta/bin:${HOME}/.cargo/bin:${HOME}/go/bin:/usr/local/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"\n',
    );
  });

  it("includes explicit service environment variables alongside PATH", async () => {
    const content = await renderLinuxServiceEnvironment({
      env: {
        OPENAI_API_KEY: "sk-test",
      },
      pathEnv: {
        PATH: "/custom/bin:/usr/bin",
      },
    });

    expect(content).toContain('OPENAI_API_KEY="sk-test"\n');
    expect(content).toContain('PATH="/custom/bin:/usr/bin:');
  });
});
