import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import {
  createPromptTemplateContext,
  renderPromptTemplate,
  type PromptTemplateSystemContext,
} from "./prompt-template.js";

describe("createPromptTemplateContext", () => {
  it("defaults reply channel context to the current endpoint transport", () => {
    const context = createPromptTemplateContext({
      system: createSystemContext(),
      agent: createAgent(),
      endpointId: "local-cli",
      transportKind: "cli",
    });

    expect(context.reply.channel).toEqual({
      kind: "cli",
      delivery: "endpoint",
      endpointId: "local-cli",
    });
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

function createAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    model: {
      provider: "faux",
      modelId: "faux-1",
    },
    prompt: {
      base: {
        text: "You are concise.",
      },
    },
    tools: [],
    extensions: [],
  };
}
