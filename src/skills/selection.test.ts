import type { AssistantMessage } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import { createLlmSkillSelector } from "./selection.js";
import type { SkillDefinition } from "./types.js";

describe("createLlmSkillSelector", () => {
  it("activates only known skills from the model response", async () => {
    const selector = createLlmSkillSelector({
      completeFn: vi.fn(async () => createAssistantMessage('{"skills":["git-review","git-commit"]}')),
    });

    const result = await selector.selectRelevantSkills({
      agent: createAgent(),
      userText: "Review the diff and then commit it.",
      catalog: [
        createSkill("git-commit", "Commit Git changes carefully."),
        createSkill("git-review", "Review Git history and diffs."),
      ],
      maxActivatedSkills: 3,
    });

    expect(result.map((skill) => skill.name)).toEqual(["git-review", "git-commit"]);
  });

  it("fails closed when the model returns an unknown skill name", async () => {
    const selector = createLlmSkillSelector({
      completeFn: vi.fn(async () => createAssistantMessage('{"skills":["unknown-skill"]}')),
    });

    await expect(
      selector.selectRelevantSkills({
        agent: createAgent(),
        userText: "Help me out.",
        catalog: [createSkill("git-commit", "Commit Git changes carefully.")],
        maxActivatedSkills: 3,
      }),
    ).rejects.toThrow('skill selector returned unknown skills: "unknown-skill"');
  });

  it("fails closed when the model response is not valid JSON", async () => {
    const selector = createLlmSkillSelector({
      completeFn: vi.fn(async () => createAssistantMessage("not json")),
    });

    await expect(
      selector.selectRelevantSkills({
        agent: createAgent(),
        userText: "Help me out.",
        catalog: [createSkill("git-commit", "Commit Git changes carefully.")],
        maxActivatedSkills: 3,
      }),
    ).rejects.toThrow("skill selector returned invalid JSON");
  });
});

function createAgent(): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    model: {
      provider: "openai",
      modelId: "gpt-5.4",
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

function createSkill(name: string, description: string): SkillDefinition {
  return {
    name,
    description,
    directoryPath: `/skills/${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    body: `\n${description}`,
    content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}`,
    references: [],
    scripts: [],
  };
}

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
