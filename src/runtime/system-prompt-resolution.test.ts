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

  it("does not cache prompts that render runtime clock values", async () => {
    let reads = 0;
    const readTextFile = async () => {
      reads += 1;
      return "Current time: {{runtime.now.iso}}.";
    };
    const cache = new SystemPromptCache({
      getContextFileFingerprint: async () => "1:1",
      readTextFile,
    });
    const agent = {
      ...createAgent(),
      prompt: {
        ...createAgent().prompt,
        instructions: [{ file: "/workspace/AGENTS.md" }],
      },
    };

    const first = await resolveSystemPrompt({
      agent,
      promptWorkingDirectory: "/workspace",
      templateContext: createTemplateContext(),
      readTextFile,
      cache,
    });

    const second = await resolveSystemPrompt({
      agent,
      promptWorkingDirectory: "/workspace",
      templateContext: createTemplateContext(),
      readTextFile,
      cache,
    });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(false);
    expect(reads).toBe(2);
  });

  it("caches prompts that render minute-precision runtime clock values for the current minute", async () => {
    let reads = 0;
    const readTextFile = async () => {
      reads += 1;
      return "Current minute: {{runtime.now.localMinute}}.";
    };
    const cache = new SystemPromptCache({
      getContextFileFingerprint: async () => "1:1",
      readTextFile,
    });
    const agent = {
      ...createAgent(),
      prompt: {
        ...createAgent().prompt,
        instructions: [{ file: "/workspace/AGENTS.md" }],
      },
    };

    const first = await resolveSystemPrompt({
      agent,
      promptWorkingDirectory: "/workspace",
      templateContext: createTemplateContext(),
      readTextFile,
      cache,
    });

    const second = await resolveSystemPrompt({
      agent,
      promptWorkingDirectory: "/workspace",
      templateContext: createTemplateContext(),
      readTextFile,
      cache,
    });

    const nextMinute = await resolveSystemPrompt({
      agent,
      promptWorkingDirectory: "/workspace",
      templateContext: createTemplateContext({
        time: "14:35:01",
        timeMinute: "14:35",
        local: "2026-04-19 14:35:01 Europe/Berlin",
        localMinute: "2026-04-19 14:35 Europe/Berlin",
      }),
      readTextFile,
      cache,
    });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(nextMinute.cacheHit).toBe(false);
    expect(reads).toBe(2);
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
          return "Endpoint {{endpoint.id}} on {{system.platform}} for {{agent.model.provider}}/{{agent.model.modelId}}.";
        }

        if (path === "/workspace/RUNBOOK.md") {
          return "Config {{imp.configPath}} data {{imp.dataRoot}} transport {{transport.kind}} reply {{reply.channel.kind}}.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toBe(
      "You are concise.\n\n" +
        '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
        "Endpoint private-telegram on linux for faux/faux-1.\n" +
        "</INSTRUCTIONS>\n\n" +
        '<REFERENCE from="/workspace/RUNBOOK.md">\n\n' +
        "Config /etc/imp/config.json data /var/lib/imp transport telegram reply telegram.\n" +
        "</REFERENCE>",
    );
  });

  it("loads agent home markdown instructions before configured instructions", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        home: "/var/lib/imp/agents/default",
        prompt: {
          base: { text: "You are concise." },
          instructions: [
            { file: "/workspace/AGENTS.md" },
            { file: "/var/lib/imp/agents/default/B.md" },
          ],
          references: [{ file: "/workspace/RUNBOOK.md" }],
        },
      },
      "/workspace",
      {
        ...createTemplateContext(),
        agent: {
          ...createTemplateContext().agent,
          home: "/var/lib/imp/agents/default",
        },
      },
      [],
      async (path) => {
        if (path === "/var/lib/imp/agents/default/A.md") {
          return "Home A at {{agent.home}}.";
        }

        if (path === "/var/lib/imp/agents/default/B.md") {
          return "Home B.";
        }

        if (path === "/workspace/AGENTS.md") {
          return "Workspace instructions.";
        }

        if (path === "/workspace/RUNBOOK.md") {
          return "Reference content.";
        }

        throw new Error(`unexpected path: ${path}`);
      },
      [
        "/var/lib/imp/agents/default/A.md",
        "/var/lib/imp/agents/default/B.md",
      ],
    );

    expect(prompt).toBe(
      "You are concise.\n\n" +
        '<INSTRUCTIONS from="/var/lib/imp/agents/default/A.md">\n\n' +
        "Home A at /var/lib/imp/agents/default.\n" +
        "</INSTRUCTIONS>\n\n" +
        '<INSTRUCTIONS from="/var/lib/imp/agents/default/B.md">\n\n' +
        "Home B.\n" +
        "</INSTRUCTIONS>\n\n" +
        '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
        "Workspace instructions.\n" +
        "</INSTRUCTIONS>\n\n" +
        '<REFERENCE from="/workspace/RUNBOOK.md">\n\n' +
        "Reference content.\n" +
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
          instructions: [{ text: "Inline {{endpoint.id}}" }, { file: "/workspace/AGENTS.md" }],
        },
      },
      "/workspace",
      createTemplateContext(),
      [],
      async (path) => {
        if (path === "/workspace/SYSTEM.md") {
          return "Base {{endpoint.id}}";
        }

        if (path === "/workspace/AGENTS.md") {
          return "File {{endpoint.id}}";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toBe(
      "Base private-telegram\n\n" +
        '<INSTRUCTIONS from="inline">\n\n' +
        "Inline {{endpoint.id}}\n" +
        "</INSTRUCTIONS>\n\n" +
        '<INSTRUCTIONS from="/workspace/AGENTS.md">\n\n' +
        "File private-telegram\n" +
        "</INSTRUCTIONS>",
    );
  });

  it("templates the built-in default prompt", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { builtIn: "default" },
        },
      },
      undefined,
      createTemplateContext(),
      [],
      async (path) => {
        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("Agent: default");
    expect(prompt).toContain("Model: faux/faux-1");
    expect(prompt).toContain("Transport: telegram");
    expect(prompt).toContain("Reply: telegram");
    expect(prompt).not.toContain("{{agent.id}}");
  });

  it("renders spoken-output guidance for audio outbox reply channels in the built-in default prompt", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { builtIn: "default" },
        },
      },
      undefined,
      {
        ...createTemplateContext(),
        reply: {
          channel: {
            kind: "audio",
            delivery: "outbox",
            endpointId: "",
          },
        },
      },
      [],
      async (path) => {
        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("Reply: audio");
    expect(prompt).toContain("The reply will be spoken aloud.");
    expect(prompt).toContain("preferably one or two short sentences");
    expect(prompt).toContain("Avoid Markdown, lists, tables, code blocks, links");
    expect(prompt).toContain("Do not include URLs or file paths in final responses.");
    expect(prompt).not.toContain("You are chatting through Telegram.");
  });

  it("renders CLI Markdown guidance in the built-in default prompt", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { builtIn: "default" },
        },
      },
      undefined,
      {
        ...createTemplateContext(),
        transport: {
          kind: "cli",
        },
        reply: {
          channel: {
            kind: "cli",
            delivery: "endpoint",
            endpointId: "local-cli",
          },
        },
      },
      [],
      async (path) => {
        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("Reply: cli");
    expect(prompt).toContain("You are chatting through the interactive CLI.");
    expect(prompt).toContain("Strikethrough with double tildes");
    expect(prompt).toContain("Simple GitHub-flavored Markdown tables");
    expect(prompt).toContain("Avoid task lists, images, raw HTML, footnotes");
    expect(prompt).not.toContain("You are chatting through Telegram.");
    expect(prompt).not.toContain("The reply will be spoken aloud.");
  });

  it("renders the same spoken-output restrictions for all audio reply channels in the built-in default prompt", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { builtIn: "default" },
        },
      },
      undefined,
      {
        ...createTemplateContext(),
        reply: {
          channel: {
            kind: "audio",
            delivery: "endpoint",
            endpointId: "speaker-room",
          },
        },
      },
      [],
      async (path) => {
        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("Reply: audio");
    expect(prompt).toContain("The reply will be spoken aloud.");
    expect(prompt).toContain("Do not include URLs or file paths in final responses.");
  });

  it("renders a minimal phone prompt without technical default sections", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { builtIn: "default" },
        },
      },
      undefined,
      {
        ...createTemplateContext(),
        conversation: {
          kind: "phone-call",
          metadata: {
            contact_name: "Thomas",
            contact_uri: "+10000000000",
          },
        },
        reply: {
          channel: {
            kind: "phone",
            delivery: "outbox",
            endpointId: "",
          },
        },
      },
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
        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("You are a helpful assistant in a live phone call.");
    expect(prompt).toContain("You are speaking with Thomas.");
    expect(prompt).toContain("Speak naturally, personally, and calmly.");
    expect(prompt).toContain("end your reply with a question");
    expect(prompt).not.toContain("Runtime Context");
    expect(prompt).not.toContain("Tooling And Execution");
    expect(prompt).not.toContain("Skills");
    expect(prompt).not.toContain("available_skills");
    expect(prompt).not.toContain("Reply channel");
    expect(prompt).not.toContain("Workspace");
    expect(prompt).not.toContain("final answer");
    expect(prompt).not.toContain("{{conversation.metadata.contact_name}}");
  });

  it("renders phone note-finalization guidance for closed phone calls", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { builtIn: "default" },
        },
      },
      undefined,
      {
        ...createTemplateContext(),
        conversation: {
          kind: "phone-call",
          metadata: {
            contact_name: "Thomas",
          },
        },
        reply: {
          channel: {
            kind: "none",
            delivery: "none",
            endpointId: "",
          },
        },
      },
      [],
      async (path) => {
        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("You are a helpful assistant in a live phone call.");
    expect(prompt).toContain("The call has ended. Finalize notes");
    expect(prompt).toContain("do not write a reply for the caller");
    expect(prompt).not.toContain("Runtime Context");
  });

  it("renders neutral guidance for none reply channels in the built-in default prompt", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { builtIn: "default" },
        },
      },
      undefined,
      {
        ...createTemplateContext(),
        reply: {
          channel: {
            kind: "none",
            delivery: "none",
            endpointId: "",
          },
        },
      },
      [],
      async (path) => {
        throw new Error(`unexpected path: ${path}`);
      },
    );

    expect(prompt).toContain("Reply: none");
    expect(prompt).toContain("Keep responses compact by default.");
    expect(prompt).not.toContain("You are chatting through Telegram.");
    expect(prompt).not.toContain("You are chatting through the interactive CLI.");
    expect(prompt).not.toContain("The reply will be spoken aloud.");
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
            "{{#if skills.length}}" +
            "Skills are a catalog. Use load_skill for relevant SKILL.md instructions and bundled scripts.\n\n" +
            "<available_skills>\n" +
            "{{#each skills}}<skill>\n" +
            "<name>\n{{instructionText name}}\n</name>\n" +
            "<description>\n{{instructionText description}}\n</description>\n" +
            "<location>\n{{instructionText filePath}}\n</location>\n" +
            "</skill>\n\n{{/each}}</available_skills>{{/if}}"
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
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("load_skill");
    expect(prompt).toContain("catalog");
    expect(prompt).toContain("SKILL.md");
    expect(prompt).toContain("bundled scripts");
    expect(prompt).toContain(
      "<skill>\n" +
        "<name>\ncommit\n</name>\n" +
        "<description>\nStage and commit changes.\n</description>\n" +
        "<location>\n/skills/commit/SKILL.md\n</location>\n" +
        "</skill>",
    );
    expect(prompt).not.toContain("name: commit");
    expect(prompt).not.toContain("Use focused commits.");
    expect(prompt).not.toContain("<SKILLS>");
    expect(prompt.indexOf("<available_skills>")).toBeLessThan(prompt.indexOf("<INSTRUCTIONS"));
    expect(prompt.indexOf("<available_skills>")).toBeLessThan(prompt.indexOf("<REFERENCE"));
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

function createTemplateContext(
  now: Partial<PromptTemplateContext["runtime"]["now"]> = {},
): PromptTemplateContext {
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
        ...now,
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
      workspace: {
        cwd: "/workspace",
      },
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
    skills: [],
  };
}
