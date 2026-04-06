import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInitialAppConfig,
  createDefaultAppConfig,
  parseCommaSeparatedValues,
  parsePathEntries,
  validateTelegramUserIds,
} from "./default-app-config.js";

describe("default app config helpers", () => {
  it("uses a base prompt file by default", () => {
    const config = createDefaultAppConfig({
      XDG_STATE_HOME: "/tmp/state-home",
    });

    expect(config.agents[0]?.prompt.base).toEqual({ file: "/tmp/state-home/imp/SYSTEM.md" });
  });

  it("adds authFile for OAuth-capable providers", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "default",
      dataRoot: "/tmp/imp",
      provider: "openai-codex",
      modelId: "gpt-5.4",
      telegramToken: "replace-me",
      allowedUserIds: [],
    });

    expect(config.agents[0]?.authFile).toBe("/tmp/imp/auth.json");
  });

  it("omits authFile for non-OAuth providers", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "default",
      dataRoot: "/tmp/imp",
      provider: "openai",
      modelId: "gpt-5.4",
      telegramToken: "replace-me",
      allowedUserIds: [],
    });

    expect(config.agents[0]?.authFile).toBeUndefined();
  });

  it("builds workspace and prompt overrides", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "home",
      dataRoot: "/tmp/imp",
      provider: "openai",
      modelId: "gpt-5.4",
      telegramToken: "replace-me",
      allowedUserIds: ["1"],
      workingDirectory: "/workspace",
      instructionFiles: [join("/workspace", "AGENTS.md")],
      referenceFiles: ["/workspace/RUNBOOK.md"],
      shellPath: ["/usr/local/bin", "/usr/bin", "/bin"],
      promptBaseFile: "/tmp/imp/SYSTEM.md",
    });

    expect(config.agents[0]?.workspace).toEqual({
      cwd: "/workspace",
      shellPath: ["/usr/local/bin", "/usr/bin", "/bin"],
    });
    expect(config.agents[0]?.prompt).toEqual({
      base: { file: "/tmp/imp/SYSTEM.md" },
      instructions: [{ file: "/workspace/AGENTS.md" }],
      references: [{ file: "/workspace/RUNBOOK.md" }],
    });
  });

  it("does not add shell path config by default", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "home",
      dataRoot: "/tmp/imp",
      provider: "openai",
      modelId: "gpt-5.4",
      telegramToken: "replace-me",
      allowedUserIds: ["1"],
      workingDirectory: "/workspace",
    });

    expect(config.agents[0]?.workspace).toEqual({
      cwd: "/workspace",
    });
  });

  it("parses comma-separated values", () => {
    expect(parseCommaSeparatedValues(" 1, 2 ,,3 ")).toEqual(["1", "2", "3"]);
  });

  it("parses colon-separated path entries", () => {
    expect(parsePathEntries(" /usr/local/bin : /usr/bin::/bin ")).toEqual([
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]);
  });

  it("validates Telegram user IDs", () => {
    expect(validateTelegramUserIds("1,2,3")).toBe(true);
    expect(validateTelegramUserIds("1,abc")).toBe("Telegram user IDs must contain digits only.");
  });
});
