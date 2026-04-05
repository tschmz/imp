import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInitialAppConfig,
  createDefaultAppConfig,
  parseCommaSeparatedValues,
  validateTelegramUserIds,
} from "./default-app-config.js";

describe("default app config helpers", () => {
  it("uses a system prompt file by default", () => {
    const config = createDefaultAppConfig({
      XDG_STATE_HOME: "/tmp/state-home",
    });

    expect(config.agents[0]?.systemPromptFile).toBe("/tmp/state-home/imp/SYSTEM.md");
    expect(config.agents[0]?.systemPrompt).toBeUndefined();
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

  it("builds context and prompt file overrides", () => {
    const config = buildInitialAppConfig(process.env, {
      instanceName: "home",
      dataRoot: "/tmp/imp",
      provider: "openai",
      modelId: "gpt-5.4",
      telegramToken: "replace-me",
      allowedUserIds: ["1"],
      workingDirectory: "/workspace",
      contextFiles: [join("/workspace", "AGENTS.md"), "/workspace/RUNBOOK.md"],
      systemPromptFile: "/tmp/imp/SYSTEM.md",
    });

    expect(config.agents[0]?.context).toEqual({
      workingDirectory: "/workspace",
      files: ["/workspace/AGENTS.md", "/workspace/RUNBOOK.md"],
    });
    expect(config.agents[0]?.systemPromptFile).toBe("/tmp/imp/SYSTEM.md");
    expect(config.agents[0]?.systemPrompt).toBeUndefined();
  });

  it("parses comma-separated values", () => {
    expect(parseCommaSeparatedValues(" 1, 2 ,,3 ")).toEqual(["1", "2", "3"]);
  });

  it("validates Telegram user IDs", () => {
    expect(validateTelegramUserIds("1,2,3")).toBe(true);
    expect(validateTelegramUserIds("1,abc")).toBe("Telegram user IDs must contain digits only.");
  });
});
