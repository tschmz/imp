import { describe, expect, it, vi } from "vitest";
import { getProviderEnvironmentVariables, promptForInitialAppConfig } from "./prompt-init-config.js";

describe("promptForInitialAppConfig", () => {
  it("returns a Telegram config and enables service installation on supported platforms", async () => {
    const env = {
      XDG_CONFIG_HOME: "/tmp/config-home",
      XDG_STATE_HOME: "/tmp/state-home",
    };
    const input = vi
      .fn()
      .mockResolvedValueOnce("default")
      .mockResolvedValueOnce("/tmp/state-home/imp")
      .mockResolvedValueOnce("gpt-5.4")
      .mockResolvedValueOnce("/workspace")
      .mockResolvedValueOnce("123:abc")
      .mockResolvedValueOnce("1, 2")
      .mockResolvedValueOnce("sk-test")
      .mockResolvedValueOnce("IMP_DEBUG=true");
    const confirm = vi.fn().mockResolvedValueOnce(true);
    const select = vi.fn().mockResolvedValue("openai");

    const result = await promptForInitialAppConfig(env, {
      input,
      confirm,
      select,
    });

    expect(result.installService).toBe(process.platform === "linux" || process.platform === "darwin");
    expect(result.config.paths.dataRoot).toBe("/tmp/state-home/imp");
    expect(result.config.agents[0]?.workspace).toEqual({
      cwd: "/workspace",
    });
    expect(result.config.agents[0]?.prompt).toEqual({
      instructions: [{ file: "/workspace/AGENTS.md" }],
    });
    const endpoint = result.config.endpoints[0];
    expect(endpoint?.type).toBe("telegram");
    if (endpoint?.type === "telegram") {
      expect(endpoint.access.allowedUserIds).toEqual(["1", "2"]);
    }
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
        message: "Allowed Telegram user IDs (comma-separated)",
      }),
    );
    expect(input.mock.calls.slice(0, 6).map(([prompt]) => prompt.message)).toEqual([
      "Instance name",
      "Data root for logs and runtime state",
      "Model ID",
      "Workspace directory for the agent (optional)",
      "Telegram bot token (optional, leave empty to skip)",
      "Allowed Telegram user IDs (comma-separated)",
    ]);
    expect(confirm).toHaveBeenCalledTimes(1);
    const allowedUserIdsPrompt = input.mock.calls[5]?.[0] as {
      validate?: (value: string) => true | string;
    };
    expect(allowedUserIdsPrompt.validate?.("")).toBe(
      "At least one Telegram user ID is required when Telegram is configured.",
    );
    expect(allowedUserIdsPrompt.validate?.("1,abc")).toBe("Telegram user IDs must contain digits only.");
  });

  it("skips Telegram and service installation when the endpoint token is omitted", async () => {
    const input = vi
      .fn()
      .mockResolvedValueOnce("default")
      .mockResolvedValueOnce("/tmp/state-home/imp")
      .mockResolvedValueOnce("gpt-5.4")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");
    const confirm = vi.fn();
    const select = vi.fn().mockResolvedValue("openai");

    const result = await promptForInitialAppConfig(process.env, {
      input,
      confirm,
      select,
    });

    expect(result.installService).toBe(false);
    expect(result.config.endpoints).toEqual([]);
    expect(result.config.agents[0]?.prompt).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("lists the expected environment variables for the openai provider", () => {
    expect(getProviderEnvironmentVariables("openai")).toEqual(["OPENAI_API_KEY"]);
  });
});
