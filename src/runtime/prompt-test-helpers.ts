import { expect } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import type { PromptTemplateContext } from "./prompt-template.js";

export interface PromptSectionExpectation {
  source: string;
  content: string;
}

export interface SystemPromptExpectation {
  base: string;
  instructions?: PromptSectionExpectation[];
  references?: PromptSectionExpectation[];
}

export function createInlineBasePrompt(
  base: string,
  options: {
    includeInstructions?: boolean;
    includeReferences?: boolean;
  } = {},
): string {
  const parts = [base];
  if (options.includeInstructions ?? true) {
    parts.push('{{promptSections "INSTRUCTIONS" prompt.instructions}}');
  }
  if (options.includeReferences ?? true) {
    parts.push('{{promptSections "REFERENCE" prompt.references}}');
  }
  return parts.join("\n\n");
}

export function renderPromptSectionForTest(
  tagName: "INSTRUCTIONS" | "REFERENCE",
  source: string,
  content: string,
): string {
  return `<${tagName} from="${source}">\n\n${content}\n</${tagName}>`;
}

export function renderSystemPromptForTest(options: SystemPromptExpectation): string {
  const parts = [options.base];
  for (const instruction of options.instructions ?? []) {
    parts.push(renderPromptSectionForTest("INSTRUCTIONS", instruction.source, instruction.content));
  }
  for (const reference of options.references ?? []) {
    parts.push(renderPromptSectionForTest("REFERENCE", reference.source, reference.content));
  }
  return parts.join("\n\n");
}

export function expectSystemPrompt(
  prompt: string | undefined,
  options: SystemPromptExpectation,
): void {
  expect(prompt).toBeDefined();
  expect(prompt).toBe(renderSystemPromptForTest(options));
}

export function createPromptTestAgent(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    model: { provider: "faux", modelId: "faux-1" },
    prompt: {
      base: { text: "You are concise." },
    },
    tools: [],
    extensions: [],
    ...overrides,
  };
}

export function createPromptTestContext(
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
    invocation: {
      kind: "direct",
      parentAgentId: "",
      toolName: "",
    },
    ingress: {
      endpoint: {
        id: "private-telegram",
      },
      transport: {
        kind: "telegram",
      },
    },
    output: {
      mode: "reply-channel",
      reply: {
        channel: {
          kind: "telegram",
          delivery: "endpoint",
          endpointId: "private-telegram",
        },
      },
    },
    endpoint: {
      id: "private-telegram",
    },
    agent: {
      id: "default",
      name: "Default",
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
    prompt: {
      instructions: [],
      references: [],
    },
    skills: [],
  };
}
