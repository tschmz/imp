import { describe, expect, it, vi } from "vitest";
import { getProviderEnvironmentVariables, promptForInitialAppConfig } from "./prompt-init-config.js";

describe("promptForInitialAppConfig", () => {
  it("returns a config and enables service installation by default", async () => {
    const env = {
      XDG_CONFIG_HOME: "/tmp/config-home",
      XDG_STATE_HOME: "/tmp/state-home",
    };
    const input = vi
      .fn()
      .mockResolvedValueOnce("default")
      .mockResolvedValueOnce("/tmp/state-home/imp")
      .mockResolvedValueOnce("gpt-5.4")
      .mockResolvedValueOnce("123:abc")
      .mockResolvedValueOnce("1, 2")
      .mockResolvedValueOnce("/workspace")
      .mockResolvedValueOnce("/workspace/RULES.md")
      .mockResolvedValueOnce("/custom/bin:/usr/bin:/bin")
      .mockResolvedValueOnce("sk-test")
      .mockResolvedValueOnce("IMP_DEBUG=true");
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const select = vi.fn().mockResolvedValue("openai");

    const result = await promptForInitialAppConfig(env, {
      input,
      confirm,
      select,
    });

    expect(result.installService).toBe(true);
    expect(result.config.paths.dataRoot).toBe("/tmp/state-home/imp");
    expect(result.config.agents[0]?.workspace).toEqual({
      cwd: "/workspace",
      shellPath: ["/custom/bin", "/usr/bin", "/bin"],
    });
    expect(result.config.agents[0]?.prompt).toEqual({
      base: {
        file: "/tmp/state-home/imp/SYSTEM.md",
      },
      instructions: [{ file: "/workspace/AGENTS.md" }],
      references: [{ file: "/workspace/RULES.md" }],
    });
    expect(result.config.bots[0]?.access.allowedUserIds).toEqual(["1", "2"]);
    if (process.platform === "linux") {
      expect(result.serviceEnvironment).toEqual({
        OPENAI_API_KEY: "sk-test",
        IMP_DEBUG: "true",
      });
    } else {
      expect(result.serviceEnvironment).toBeUndefined();
    }
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "Load AGENTS.md from that workspace as project instructions?",
        default: true,
      }),
    );
    expect(input).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        message: "Workspace directory for the agent (optional)",
      }),
    );
    expect(input).toHaveBeenNthCalledWith(
      7,
      expect.objectContaining({
        message: "Additional reference files for the prompt (comma-separated, optional)",
      }),
    );
    expect(input).toHaveBeenNthCalledWith(
      8,
      expect.objectContaining({
        message: "Workspace shell PATH for the bash tool (colon-separated, optional)",
      }),
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "Install and start imp as a background service now?",
        default: true,
      }),
    );
  });

  it("allows skipping service installation", async () => {
    const input = vi
      .fn()
      .mockResolvedValueOnce("default")
      .mockResolvedValueOnce("/tmp/state-home/imp")
      .mockResolvedValueOnce("gpt-5.4")
      .mockResolvedValueOnce("123:abc")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");
    input.mockResolvedValueOnce("");
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const select = vi.fn().mockResolvedValue("openai");

    const result = await promptForInitialAppConfig(process.env, {
      input,
      confirm,
      select,
    });

    expect(result.installService).toBe(false);
    expect(result.config.agents[0]?.prompt.base).toEqual({
      file: "/tmp/state-home/imp/SYSTEM.md",
    });
  });

  it("lists the expected environment variables for the openai provider", () => {
    expect(getProviderEnvironmentVariables("openai")).toEqual(["OPENAI_API_KEY"]);
  });
});
