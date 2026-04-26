import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import {
  createInlineBasePrompt,
  createPromptTestAgent,
  createPromptTestContext,
  expectSystemPrompt,
} from "./prompt-test-helpers.js";
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
          base: { text: createInlineBasePrompt("You are concise.") },
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

    expectSystemPrompt(prompt, {
      base: "You are concise.",
      instructions: [
        {
          source: "/workspace/AGENTS.md",
          content: "Endpoint private-telegram on linux for faux/faux-1.",
        },
      ],
      references: [
        {
          source: "/workspace/RUNBOOK.md",
          content: "Config /etc/imp/config.json data /var/lib/imp transport telegram reply telegram.",
        },
      ],
    });
  });

  it("loads agent home markdown instructions before configured instructions", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        home: "/var/lib/imp/agents/default",
        prompt: {
          base: { text: createInlineBasePrompt("You are concise.") },
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

    expectSystemPrompt(prompt, {
      base: "You are concise.",
      instructions: [
        {
          source: "/var/lib/imp/agents/default/A.md",
          content: "Home A at /var/lib/imp/agents/default.",
        },
        {
          source: "/var/lib/imp/agents/default/B.md",
          content: "Home B.",
        },
        {
          source: "/workspace/AGENTS.md",
          content: "Workspace instructions.",
        },
      ],
      references: [
        {
          source: "/workspace/RUNBOOK.md",
          content: "Reference content.",
        },
      ],
    });
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
          base: { text: createInlineBasePrompt("You are concise.", { includeReferences: false }) },
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

    expectSystemPrompt(prompt, {
      base: "You are concise.",
      instructions: [
        {
          source: "/workspace/AGENTS.md",
          content: "auth=[] cwd=[] config=[] data=[]",
        },
      ],
    });
  });

  it("supports Handlebars conditionals and loops in file-backed prompt templates", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: { text: createInlineBasePrompt("You are concise.", { includeReferences: false }) },
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

  it("templates inline and file-backed prompt sources", async () => {
    const prompt = await buildSystemPrompt(
      {
        ...createAgent(),
        prompt: {
          base: {
            text: createInlineBasePrompt("Base {{endpoint.id}}", { includeReferences: false }),
          },
          instructions: [{ text: "Inline {{endpoint.id}}" }, { file: "/workspace/AGENTS.md" }],
        },
      },
      "/workspace",
      createTemplateContext(),
      [],
      async (path) => {
        if (path === "/workspace/AGENTS.md") {
          return "File {{endpoint.id}}";
        }

        throw new Error(`unexpected path: ${path}`);
      },
    );

    expectSystemPrompt(prompt, {
      base: "Base private-telegram",
      instructions: [
        {
          source: "inline",
          content: "Inline private-telegram",
        },
        {
          source: "/workspace/AGENTS.md",
          content: "File private-telegram",
        },
      ],
    });
  });

  it("renders the built-in default prompt without unresolved template expressions", async () => {
    const prompt = await buildDefaultSystemPrompt();

    expectRenderedTemplate(prompt);
  });
  it("uses delegated communication rules for delegated child runs", async () => {
    const prompt = await buildDefaultSystemPrompt({
      templateContext: mergeTemplateContext(createTemplateContext(), {
        invocation: {
          kind: "delegated",
          parentAgentId: "default",
          toolName: "ask_helper",
        },
        output: {
          mode: "delegated-tool",
          reply: {
            channel: {
              kind: "none",
              delivery: "none",
              endpointId: "",
            },
          },
        },
      }),
    });

    expect(prompt).toContain("- Invocation: delegated");
    expect(prompt).toContain("- Output: delegated-tool");
    expect(prompt).toContain("You are running as a delegated child agent through a tool call");
    expect(prompt).not.toContain("You are chatting through Telegram.");
  });

  it.each([
    {
      name: "audio outbox reply channels",
      context: {
        reply: {
          channel: {
            kind: "audio" as const,
            delivery: "outbox" as const,
            endpointId: "",
          },
        },
      },
    },
    {
      name: "CLI reply channels",
      context: {
        transport: {
          kind: "cli",
        },
        reply: {
          channel: {
            kind: "cli" as const,
            delivery: "endpoint" as const,
            endpointId: "local-cli",
          },
        },
      },
    },
    {
      name: "audio endpoint reply channels",
      context: {
        reply: {
          channel: {
            kind: "audio" as const,
            delivery: "endpoint" as const,
            endpointId: "speaker-room",
          },
        },
      },
    },
    {
      name: "none reply channels",
      context: {
        reply: {
          channel: {
            kind: "none" as const,
            delivery: "none" as const,
            endpointId: "",
          },
        },
      },
    },
    {
      name: "missing optional workspace values",
      context: {
        agent: {
          ...createTemplateContext().agent,
          workspace: {
            cwd: "",
          },
        },
      },
    },
    {
      name: "available skills",
      context: {},
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
    },
  ])("renders $name in the built-in default prompt without unresolved template expressions", async ({
    context,
    availableSkills,
  }) => {
    const prompt = await buildDefaultSystemPrompt({
      templateContext: mergeTemplateContext(createTemplateContext(), context),
      availableSkills,
    });

    expectRenderedTemplate(prompt);
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
            "</skill>\n\n{{/each}}</available_skills>{{/if}}\n\n" +
            "{{#each prompt.instructions}}<INSTRUCTIONS from=\"{{instructionAttr source}}\">\n\n{{instructionText content}}\n</INSTRUCTIONS>\n\n{{/each}}" +
            "{{#each prompt.references}}<REFERENCE from=\"{{instructionAttr source}}\">\n\n{{instructionText content}}\n</REFERENCE>\n\n{{/each}}"
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

function expectRenderedTemplate(prompt: string): void {
  expect(prompt.trim().length).toBeGreaterThan(0);
  expect(prompt).not.toMatch(/\{\{[^}]+}}/);
}

function createAgent(): AgentDefinition {
  return createPromptTestAgent({
    prompt: {
      base: { text: createInlineBasePrompt("You are concise.") },
      instructions: [{ file: "/workspace/AGENTS.md" }],
    },
  });
}

function createTemplateContext(
  now: Partial<PromptTemplateContext["runtime"]["now"]> = {},
): PromptTemplateContext {
  return createPromptTestContext(now);
}

async function buildDefaultSystemPrompt(options: {
  templateContext?: PromptTemplateContext;
  availableSkills?: Parameters<typeof buildSystemPrompt>[3];
} = {}): Promise<string> {
  return await buildSystemPrompt(
    {
      ...createAgent(),
      prompt: {
        base: { builtIn: "default" },
      },
    },
    undefined,
    options.templateContext ?? createTemplateContext(),
    options.availableSkills ?? [],
    async (path) => {
      throw new Error(`unexpected path: ${path}`);
    },
  );
}

function mergeTemplateContext(
  base: PromptTemplateContext,
  overrides: Partial<PromptTemplateContext>,
): PromptTemplateContext {
  const ingressEndpointId = overrides.ingress?.endpoint?.id ?? overrides.endpoint?.id ?? base.ingress.endpoint.id;
  const ingressTransportKind = overrides.ingress?.transport?.kind ?? overrides.transport?.kind ?? base.ingress.transport.kind;
  const outputReplyChannel = {
    ...base.output.reply.channel,
    ...overrides.reply?.channel,
    ...overrides.output?.reply?.channel,
  };

  return {
    ...base,
    ...overrides,
    system: {
      ...base.system,
      ...overrides.system,
    },
    runtime: {
      ...base.runtime,
      ...overrides.runtime,
      now: {
        ...base.runtime.now,
        ...overrides.runtime?.now,
      },
    },
    invocation: {
      ...base.invocation,
      ...overrides.invocation,
    },
    ingress: {
      ...base.ingress,
      ...overrides.ingress,
      endpoint: {
        ...base.ingress.endpoint,
        ...overrides.ingress?.endpoint,
        id: ingressEndpointId,
      },
      transport: {
        ...base.ingress.transport,
        ...overrides.ingress?.transport,
        kind: ingressTransportKind,
      },
    },
    output: {
      ...base.output,
      ...overrides.output,
      reply: {
        ...base.output.reply,
        ...overrides.output?.reply,
        channel: outputReplyChannel,
      },
    },
    endpoint: {
      ...base.endpoint,
      ...overrides.endpoint,
      id: ingressEndpointId,
    },
    agent: {
      ...base.agent,
      ...overrides.agent,
      model: {
        ...base.agent.model,
        ...overrides.agent?.model,
      },
      workspace: {
        ...base.agent.workspace,
        ...overrides.agent?.workspace,
      },
    },
    transport: {
      ...base.transport,
      ...overrides.transport,
      kind: ingressTransportKind,
    },
    conversation: {
      ...base.conversation,
      ...overrides.conversation,
      metadata: {
        ...base.conversation.metadata,
        ...overrides.conversation?.metadata,
      },
    },
    reply: {
      ...base.reply,
      ...overrides.reply,
      channel: outputReplyChannel,
    },
    imp: {
      ...base.imp,
      ...overrides.imp,
    },
    prompt: {
      ...base.prompt,
      ...overrides.prompt,
      instructions: overrides.prompt?.instructions ?? base.prompt.instructions,
      references: overrides.prompt?.references ?? base.prompt.references,
    },
    skills: overrides.skills ?? base.skills,
  };
}
