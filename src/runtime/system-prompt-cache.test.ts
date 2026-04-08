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
    expect(key).toContain('"bot":{"id":"private-telegram"}');
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
    bot: {
      id: "private-telegram",
    },
    agent: {
      id: "default",
      model: {
        provider: "faux",
        modelId: "faux-1",
      },
      workspace: {},
    },
    transport: {
      kind: "telegram",
    },
    imp: {
      configPath: "/etc/imp/config.json",
      dataRoot: "/var/lib/imp",
    },
  };
}
