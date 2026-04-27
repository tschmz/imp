import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import { resolveWorkingDirectory } from "./working-directory-tools.js";

describe("resolveWorkingDirectory", () => {
  it("prefers workspace cwd over agent home", () => {
    expect(resolveWorkingDirectory(createAgent({
      home: "/agents/default",
      workspace: { cwd: "/workspace/project" },
    }))).toBe("/workspace/project");
  });

  it("falls back to agent home when workspace cwd is not configured", () => {
    expect(resolveWorkingDirectory(createAgent({
      home: "/agents/default",
    }))).toBe("/agents/default");
  });

  it("falls back to the process cwd when neither workspace nor home is configured", () => {
    expect(resolveWorkingDirectory(createAgent())).toBe(process.cwd());
  });
});

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    prompt: {
      base: { text: "You are concise." },
    },
    model: {
      provider: "test",
      modelId: "stub",
    },
    tools: [],
    extensions: [],
    ...overrides,
  };
}
