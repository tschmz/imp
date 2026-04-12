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
      [],
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
        [],
        async (path) => {
          if (path === "/workspace/AGENTS.md") {
            return "Unknown {{agent.unknownField}}";
          }

          throw new Error(`unexpected path: ${path}`);
        },
      ),
    ).rejects.toThrow(
      'Failed to render prompt template /workspace/AGENTS.md: "unknownField" not defined',
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
      [],
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

  it("supports Handlebars conditionals and loops in file-backed prompt templates", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { text: "You are concise." },
          instructions: [{ file: "/workspace/AGENTS.md" }],
        },
      },
      "/workspace",
      createTemplateContext(),
      [
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
      async (path) => {
        if (path === "/workspace/AGENTS.md") {
          return "{{#if skills.length}}{{#each skills}}{{name}}:{{description}}{{/each}}{{else}}no skills{{/if}}";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("commit:Stage and commit changes.");
  });

  it("templates file-backed prompt.base but not inline text sources", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { file: "/workspace/SYSTEM.md" },
          instructions: [{ text: "Inline {{bot.id}}" }, { file: "/workspace/AGENTS.md" }],
        },
      },
      "/workspace",
      createTemplateContext(),
      [],
      async (path) => {
        if (path === "/workspace/SYSTEM.md") {
          return "Base {{bot.id}}";
        }

        if (path === "/workspace/AGENTS.md") {
          return "File {{bot.id}}";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toBe(
      "Base private-telegram\n\n" +
        '<INSTRUCTIONS from="inline">\n\n' +
        "Inline {{bot.id}}\n" +
        "</INSTRUCTIONS>\n\n" +
        '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
        "File private-telegram\n" +
        "</INSTRUCTIONS>",
    );
  });

  it("injects available skill metadata before additional context files", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { file: "/workspace/SYSTEM.md" },
          instructions: [{ file: "/workspace/AGENTS.md" }],
          references: [{ file: "/workspace/RUNBOOK.md" }],
        },
      },
      undefined,
      createTemplateContext(),
      [
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
      async (path) => {
        if (path === "/workspace/SYSTEM.md") {
          return (
            "{{#if skills.length}}<AVAILABLE-SKILLS>\n\n" +
            "You have access to the following skills.\n" +
            "Treat this list as a catalog, not as full skill instructions.\n" +
            "Use the load_skill tool when a listed skill is relevant to the user's request.\n" +
            "Use exact skill names when loading or referring to skills.\n" +
            "The catalog lists path, name, and description only.\n\n" +
            '{{#each skills}}<AVAILABLE-SKILL name="{{instructionAttr name}}" from="{{instructionAttr directoryPath}}">\n' +
            "{{description}}\n" +
            "</AVAILABLE-SKILL>\n\n{{/each}}</AVAILABLE-SKILLS>{{/if}}"
          );
        }

        if (path === "/workspace/AGENTS.md") {
          return "Project instructions.";
        }

        if (path === "/workspace/RUNBOOK.md") {
          return "Reference content.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("<AVAILABLE-SKILLS>");
    expect(prompt).toContain("You have access to the following skills.");
    expect(prompt).toContain("Treat this list as a catalog, not as full skill instructions.");
    expect(prompt).toContain("Use the load_skill tool when a listed skill is relevant to the user's request.");
    expect(prompt).toContain("Use exact skill names when loading or referring to skills.");
    expect(prompt).toContain('<AVAILABLE-SKILL name="commit" from="/skills/commit">\nStage and commit changes.\n</AVAILABLE-SKILL>');
    expect(prompt).not.toContain("name: commit");
    expect(prompt).not.toContain("Use focused commits.");
    expect(prompt).not.toContain("<SKILLS>");
    expect(prompt.indexOf("<AVAILABLE-SKILLS>")).toBeLessThan(prompt.indexOf("<INSTRUCTIONS"));
    expect(prompt.indexOf("<AVAILABLE-SKILLS>")).toBeLessThan(prompt.indexOf("<REFERENCE"));
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
    skills: [],
  };
}
