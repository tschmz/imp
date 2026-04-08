import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import type { PromptTemplateContext } from "./prompt-template.js";
import { SystemPromptCache } from "./system-prompt-cache.js";
import { buildSystemPrompt, resolveSystemPrompt } from "./system-prompt-resolution.js";

describe("resolveSystemPrompt", () => {
  it("returns cache hit metadata", async () => {
    const readTextFile = async () => "Follow instructions.";
    const cache = new SystemPromptCache({
      getContextFileFingerprint: async () => "1:1",
      readTextFile,
    });

    const first = await resolveSystemPrompt({
      agent: createAgent(),
      promptWorkingDirectory: "/workspace",
      templateContext: createTemplateContext(),
      readTextFile,
      cache,
    });

    const second = await resolveSystemPrompt({
      agent: createAgent(),
      promptWorkingDirectory: "/workspace",
      templateContext: createTemplateContext(),
      readTextFile,
      cache,
    });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
  });

  it("renders curated template variables for file-backed instructions and references", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { text: "You are concise." },
          instructions: [{ file: "/workspace/AGENTS.md" }],
          references: [{ file: "/workspace/RUNBOOK.md" }],
        },
      },
      "/workspace",
      createTemplateContext(),
      async (path) => {
        if (path === "/workspace/AGENTS.md") {
          return "Bot {{bot.id}} on {{system.platform}} for {{agent.model.provider}}/{{agent.model.modelId}}.";
        }

        if (path === "/workspace/RUNBOOK.md") {
          return "Config {{imp.configPath}} data {{imp.dataRoot}} transport {{transport.kind}}.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toBe(
      "You are concise.\n\n" +
        '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
        "Bot private-telegram on linux for faux/faux-1.\n" +
        "</INSTRUCTIONS>\n\n" +
        '<REFERENCE from="/workspace/RUNBOOK.md">\n\n' +
        "Config /etc/imp/config.json data /var/lib/imp transport telegram.\n" +
        "</REFERENCE>",
    );
  });

  it("fails clearly when a file-backed prompt template references an unknown variable", async () => {
    await expect(
      buildSystemPrompt(
        createAgent(),
        "/workspace",
        createTemplateContext(),
        async (path) => {
          if (path === "/workspace/AGENTS.md") {
            return "Unknown {{agent.unknownField}}";
          }

          throw new Error(`unexpected path: ${path}`);
        },
      ),
    ).rejects.toThrow(
      "Unknown prompt template variable in /workspace/AGENTS.md: agent.unknownField. Available top-level roots: system, bot, agent, transport, imp",
    );
  });

  it("renders documented but unavailable variables as empty strings", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        authFile: undefined,
        workspace: undefined,
        prompt: {
          base: { text: "You are concise." },
          instructions: [{ file: "/workspace/AGENTS.md" }],
        },
      },
      "/workspace",
      {
        ...createTemplateContext(),
        agent: {
          ...createTemplateContext().agent,
          authFile: "",
          workspace: {
            cwd: "",
          },
        },
        imp: {
          configPath: "",
          dataRoot: "",
        },
      },
      async (path) => {
        if (path === "/workspace/AGENTS.md") {
          return "auth=[{{agent.authFile}}] cwd=[{{agent.workspace.cwd}}] config=[{{imp.configPath}}] data=[{{imp.dataRoot}}]";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toBe(
      "You are concise.\n\n" +
        '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
        "auth=[] cwd=[] config=[] data=[]\n" +
        "</INSTRUCTIONS>",
    );
  });

  it("fails clearly when a file-backed prompt template uses unsupported syntax", async () => {
    await expect(
      buildSystemPrompt(
        createAgent(),
        "/workspace",
        createTemplateContext(),
        async (path) => {
          if (path === "/workspace/AGENTS.md") {
            return "Invalid {{ agent.id }}";
          }

          throw new Error(`unexpected path: ${path}`);
        },
      ),
    ).rejects.toThrow(
      "Unsupported prompt template expression in /workspace/AGENTS.md: {{ agent.id }}. Only {{path.to.value}} is supported.",
    );
  });

  it("does not template prompt.base or inline text sources", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { text: "Base {{bot.id}}" },
          instructions: [{ text: "Inline {{bot.id}}" }, { file: "/workspace/AGENTS.md" }],
        },
      },
      "/workspace",
      createTemplateContext(),
      async (path) => {
        if (path === "/workspace/AGENTS.md") {
          return "File {{bot.id}}";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toBe(
      "Base {{bot.id}}\n\n" +
        '<INSTRUCTIONS from="inline">\n\n' +
        "Inline {{bot.id}}\n" +
        "</INSTRUCTIONS>\n\n" +
        '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
        "File private-telegram\n" +
        "</INSTRUCTIONS>",
    );
  });
});

function createAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    model: { provider: "faux", modelId: "faux-1" },
    prompt: {
      base: { text: "You are concise." },
      instructions: [{ file: "/workspace/AGENTS.md" }],
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
      workspace: {
        cwd: "/workspace",
      },
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
