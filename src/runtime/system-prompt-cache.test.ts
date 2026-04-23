import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import { InMemoryCacheStrategy, SystemPromptCache } from "./system-prompt-cache.js";
import type { PromptTemplateContext } from "./prompt-template.js";

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
  return {
    id: "default",
    name: "Default",
    model: { provider: "faux", modelId: "faux-1" },
    prompt: {
      base: {
        text: "You are concise.",
      },
    },
    tools: [],
    extensions: [],
  };
}

function createTemplateContext(): PromptTemplateContext {
  return {
    system: {
      os: "Linux",
      platform: "linux",
      arch: "x64",
      hostname: "builder",
      username: "thomas",
      homeDir: "/home/thomas",
    },
    runtime: {
      now: {
        iso: "2026-04-19T12:34:56.000Z",
        date: "2026-04-19",
        time: "14:34:56",
        timeMinute: "14:34",
        local: "2026-04-19 14:34:56 Europe/Berlin",
        localMinute: "2026-04-19 14:34 Europe/Berlin",
      },
      timezone: "Europe/Berlin",
    },
    endpoint: {
      id: "private-telegram",
    },
    agent: {
      id: "default",
      home: "/var/lib/imp/agents/default",
      model: {
        provider: "faux",
        modelId: "faux-1",
      },
      workspace: {},
    },
    transport: {
      kind: "telegram",
    },
    conversation: {
      kind: "",
      metadata: {},
    },
    reply: {
      channel: {
        kind: "telegram",
        delivery: "endpoint",
        endpointId: "private-telegram",
      },
    },
    imp: {
      configPath: "/etc/imp/config.json",
      dataRoot: "/var/lib/imp",
    },
    prompt: {
      instructions: [],
      references: [],
    },
    skills: [],
  };
}
