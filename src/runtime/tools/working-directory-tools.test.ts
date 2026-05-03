import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../domain/agent.js";
import { resolveWorkingDirectory } from "./working-directory-tools.js";

describe("resolveWorkingDirectory", () => {
  it("resolves workspace, agent home, and process cwd by precedence", () => {
    expect(resolveWorkingDirectory(createAgent({
      home: "/agents/default",
      workspace: { cwd: "/workspace/project" },
    }))).toBe("/workspace/project");

    expect(resolveWorkingDirectory(createAgent({
      home: "/agents/default",
    }))).toBe("/agents/default");

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
