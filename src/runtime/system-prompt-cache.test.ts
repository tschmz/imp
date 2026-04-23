import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import { InMemoryCacheStrategy, SystemPromptCache } from "./system-prompt-cache.js";
import type { PromptTemplateContext } from "./prompt-template.js";
import { createPromptTestAgent, createPromptTestContext } from "./prompt-test-helpers.js";

describe("SystemPromptCache", () => {
  it("builds cache keys using file fingerprints", async () => {
    const cache = new SystemPromptCache({
      getContextFileFingerprint: async (path) => `${path}:fp`,
      readTextFile: async () => "unused",
      strategy: new InMemoryCacheStrategy<string>(),
    });

    const key = await cache.buildCacheKey({
      agent: createAgent(),
      promptWorkingDirectory: "/workspace/project",
      promptFiles: ["/workspace/AGENTS.md"],
      templateContext: createTemplateContext(),
    });

    expect(key).toContain('"files":["/workspace/AGENTS.md:/workspace/AGENTS.md:fp"]');
    expect(key).toContain('"endpoint":{"id":"private-telegram"}');
    expect(key).toContain('"reply":{"channel":{"kind":"telegram","delivery":"endpoint","endpointId":"private-telegram"}}');
  });

  it("includes available skill metadata without full skill content in cache keys", async () => {
    const cache = new SystemPromptCache({
      getContextFileFingerprint: async () => "fp",
      readTextFile: async () => "unused",
      strategy: new InMemoryCacheStrategy<string>(),
    });

    const key = await cache.buildCacheKey({
      agent: createAgent(),
      promptWorkingDirectory: "/workspace/project",
      promptFiles: [],
      templateContext: createTemplateContext(),
      availableSkills: [
        {
          name: "commit",
          description: "Stage and commit changes.",
          directoryPath: "/skills/commit",
          filePath: "/skills/commit/SKILL.md",
          body: "\nUse focused commits.",
          content: "---\nname: commit\ndescription: Stage and commit changes.\n---\n\nUse focused commits.",
          references: [],
          scripts: [],
        },
      ],
    });

    expect(key).toContain(
      '"availableSkills":[{"directoryPath":"/skills/commit","filePath":"/skills/commit/SKILL.md","name":"commit","description":"Stage and commit changes."}]',
    );
    expect(key).not.toContain("Use focused commits.");
    expect(key).not.toContain('"content":"---\\nname: commit');
  });

  it("omits runtime clock values from cache keys", async () => {
    const cache = new SystemPromptCache({
      getContextFileFingerprint: async () => "fp",
      readTextFile: async () => "No dynamic time here.",
      strategy: new InMemoryCacheStrategy<string>(),
    });

    const key = await cache.buildCacheKey({
      agent: createAgent(),
      promptWorkingDirectory: "/workspace/project",
      promptFiles: ["/workspace/AGENTS.md"],
      templateContext: createTemplateContext(),
    });

    expect(key).not.toContain("2026-04-19T12:34:56.000Z");
    expect(key).toContain('"runtime":{"timezone":"Europe/Berlin"}');
  });

  it("evicts prior key per agent on set", () => {
    const strategy = new InMemoryCacheStrategy<string>();
    const cache = new SystemPromptCache({
      getContextFileFingerprint: async () => "fp",
      readTextFile: async () => "unused",
      strategy,
    });

    cache.set("default", "key-1", "prompt-1");
    cache.set("default", "key-2", "prompt-2");

    expect(cache.get("key-1")).toBeUndefined();
    expect(cache.get("key-2")).toBe("prompt-2");
  });
});

function createAgent(): AgentDefinition {
  return createPromptTestAgent();
}

function createTemplateContext(): PromptTemplateContext {
  const context = createPromptTestContext();
  return {
    ...context,
    agent: {
      ...context.agent,
      workspace: {},
    },
  };
}
