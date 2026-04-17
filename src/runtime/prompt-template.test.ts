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
      transportKind: "plugin",
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
