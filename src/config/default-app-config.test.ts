import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInitialAppConfig,
  createDefaultAppConfig,
  parseCommaSeparatedValues,
  validateTelegramUserIds,
} from "./default-app-config.js";

describe("default app config helpers", () => {
  it("omits prompt.base by default so the runtime uses the built-in prompt", () => {
    const config = createDefaultAppConfig({
      XDG_STATE_HOME: "/tmp/state-home",
    });

    expect(config.agents[0]?.prompt).toBeUndefined();
  });

  it("does not create daemon endpoints by default", () => {
    const config = createDefaultAppConfig({
      XDG_STATE_HOME: "/tmp/state-home",
    });

    expect(config.endpoints).toEqual([]);
  });


  it("stores the initial provider and model in defaults.model", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "default",
      dataRoot: "/tmp/imp",
      provider: "openai",
      modelId: "gpt-5.4",
    });

    expect(config.defaults.model).toEqual({
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(config.agents[0]?.model).toBeUndefined();
  });

  it("creates a telegram endpoint when a token is provided", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "default",
      dataRoot: "/tmp/imp",
      provider: "openai",
      modelId: "gpt-5.4",
      telegramToken: "123:abc",
      allowedUserIds: ["1"],
    });

    expect(config.endpoints).toEqual([
      {
        id: "private-telegram",
        type: "telegram",
        enabled: true,
        token: "123:abc",
        access: {
          allowedUserIds: ["1"],
        },
      },
    ]);
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

  it("builds prompt context without a base override", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "home",
      dataRoot: "/tmp/imp",
      provider: "openai",
      modelId: "gpt-5.4",
      telegramToken: "replace-me",
      allowedUserIds: ["1"],
      instructionFiles: [join("/workspace", "AGENTS.md")],
      referenceFiles: ["/workspace/RUNBOOK.md"],
    });

    expect(config.agents[0]?.prompt).toEqual({
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

  it("validates Telegram user IDs", () => {
    expect(validateTelegramUserIds("1,2,3")).toBe(true);
    expect(validateTelegramUserIds("1,abc")).toBe("Telegram user IDs must contain digits only.");
  });
});
