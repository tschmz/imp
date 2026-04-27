import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import {
  createPromptTemplateContext,
  renderPromptTemplate,
  renderPromptSections,
  type PromptTemplateSystemContext,
} from "./prompt-template.js";
import { createPromptTestAgent } from "./prompt-test-helpers.js";

describe("createPromptTemplateContext", () => {
  it("defaults direct invocation, ingress, and reply output context", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "local-cli",
      transportKind: "cli",
    });

    expect(context.invocation).toEqual({
      kind: "direct",
      parentAgentId: "",
      toolName: "",
    });
    expect(context.ingress).toEqual({
      endpoint: {
        id: "local-cli",
      },
      transport: {
        kind: "cli",
      },
    });
    expect(context.output).toEqual({
      mode: "reply-channel",
      reply: {
        channel: {
          kind: "cli",
          delivery: "endpoint",
          endpointId: "local-cli",
        },
      },
    });
    expect(context.reply.channel).toEqual({
      kind: "cli",
      delivery: "endpoint",
      endpointId: "local-cli",
    });
  });

  it("renders delegated invocation and tool output context in prompt templates", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "private-telegram",
      transportKind: "telegram",
      invocation: {
        kind: "delegated",
        parentAgentId: "default",
        toolName: "ask_helper",
      },
      output: {
        mode: "delegated-tool",
      },
    });

    const rendered = renderPromptTemplate(
      '{{invocation.kind}} {{invocation.parentAgentId}} {{invocation.toolName}} {{ingress.transport.kind}} {{output.mode}} {{reply.channel.kind}}',
      {
        filePath: "/workspace/SYSTEM.md",
        context,
      },
    );

    expect(rendered).toBe("delegated default ask_helper telegram delegated-tool none");
  });

  it("renders agent identity in prompt templates", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent({
        id: "imp-agents.cody",
        name: "Cody",
      }),
      endpointId: "local-cli",
      transportKind: "cli",
    });

    const rendered = renderPromptTemplate("{{agent.id}} {{agent.name}}", {
      filePath: "/workspace/SYSTEM.md",
      context,
    });

    expect(rendered).toBe("imp-agents.cody Cody");
  });

  it("renders explicit reply channel context in prompt templates", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "audio-ingress",
      transportKind: "file",
      replyChannel: {
        kind: "audio",
        delivery: "outbox",
      },
    });

    const rendered = renderPromptTemplate(
      '{{reply.channel.kind}} {{reply.channel.delivery}} {{#if (eq reply.channel.kind "audio")}}spoken{{/if}}',
      {
        filePath: "/workspace/SYSTEM.md",
        context,
      },
    );

    expect(rendered).toBe("audio outbox spoken");
  });

  it("renders conversation kind and metadata in prompt templates", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "phone-ingress",
      transportKind: "file",
      conversation: {
        state: {
          conversation: {
            transport: "file",
            externalId: "imp-phone-call-1",
            sessionId: "imp-phone-call-1",
          },
          agentId: "default",
          kind: "phone-call",
          metadata: {
            contact_name: "Thomas",
            contact_uri: "+10000000000",
          },
          createdAt: "2026-04-19T12:00:00.000Z",
          updatedAt: "2026-04-19T12:00:00.000Z",
          version: 1,
        },
        messages: [],
      },
    });

    const rendered = renderPromptTemplate(
      '{{conversation.kind}} {{conversation.metadata.contact_name}} {{conversation.metadata.contact_uri}}',
      {
        filePath: "/workspace/SYSTEM.md",
        context,
      },
    );

    expect(rendered).toBe("phone-call Thomas +10000000000");
  });

  it("renders runtime date and time in prompt templates", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "phone-ingress",
      transportKind: "file",
      now: new Date("2026-04-19T12:34:56.000Z"),
      timezone: "Europe/Berlin",
    });

    const rendered = renderPromptTemplate(
      "{{runtime.now.iso}} | {{runtime.now.date}} | {{runtime.now.time}} | {{runtime.now.timeMinute}} | {{runtime.now.local}} | {{runtime.now.localMinute}} | {{runtime.timezone}}",
      {
        filePath: "/workspace/SYSTEM.md",
        context,
      },
    );

    expect(rendered).toBe(
      "2026-04-19T12:34:56.000Z | 2026-04-19 | 14:34:56 | 14:34 | 2026-04-19 14:34:56 Europe/Berlin | 2026-04-19 14:34 Europe/Berlin | Europe/Berlin",
    );
  });

  it("renders imp skill catalog paths in prompt templates", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "local-cli",
      transportKind: "cli",
    });

    context.imp.skillCatalogs = [
      { label: "global", path: "/var/lib/imp/skills" },
      { label: "agent-home for default", path: "/agents/default/.skills" },
    ];
    context.imp.dynamicWorkspaceSkillsPath = "<working-directory>/.skills";

    const rendered = renderPromptTemplate(
      "{{#each imp.skillCatalogs}}{{label}}={{path}};{{/each}}{{imp.dynamicWorkspaceSkillsPath}}",
      {
        filePath: "/workspace/SYSTEM.md",
        context,
      },
    );

    expect(rendered).toBe(
      "global=/var/lib/imp/skills;agent-home for default=/agents/default/.skills;<working-directory>/.skills",
    );
  });

  it("includes resolved runtime skill catalogs from data root, agent home, configured paths, and workspace", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent({
        home: "/agents/default",
        workspace: {
          cwd: "/workspace/project",
        },
        skills: {
          paths: ["/shared/skills-a", "/shared/skills-b"],
        },
      }),
      endpointId: "local-cli",
      transportKind: "cli",
      dataRoot: "/var/lib/imp",
    });

    expect(context.imp.skillCatalogs).toEqual([
      { label: "global shared catalog", path: "/var/lib/imp/skills" },
      { label: "agent-home catalog for default", path: "/agents/default/.skills" },
      { label: "configured shared catalog for default", path: "/shared/skills-a" },
      { label: "configured shared catalog for default", path: "/shared/skills-b" },
      { label: "workspace catalog for default", path: "/workspace/project/.skills" },
    ]);
    expect(context.imp.dynamicWorkspaceSkillsPath).toBe("/workspace/project/.skills");
  });

  it("renders included prompt sections through the shared helper", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "local-cli",
      transportKind: "cli",
    });
    context.prompt.instructions = [
      { source: "/workspace/AGENTS.md", content: "Use facts." },
    ];

    const rendered = renderPromptTemplate('{{promptSections "INSTRUCTIONS" prompt.instructions}}', {
      filePath: "/workspace/SYSTEM.md",
      context,
    });

    expect(rendered).toBe(renderPromptSections("INSTRUCTIONS", context.prompt.instructions));
  });
});

function createSystemContext(): PromptTemplateSystemContext {
  return {
    os: "Linux",
    platform: "linux",
    arch: "x64",
    hostname: "builder",
    username: "thomas",
    homeDir: "/home/thomas",
  };
}

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return createPromptTestAgent(overrides);
}
