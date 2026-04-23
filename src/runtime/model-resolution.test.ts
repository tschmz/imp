import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import { resolveConfiguredModel, resolveModelOrThrow } from "./model-resolution.js";

describe("resolveModelOrThrow", () => {
  it("returns the resolved model", () => {
    const model = { id: "faux-1", provider: "faux", api: "openai-responses" } as never;
    const agent = createAgent();

    const resolved = resolveModelOrThrow(agent, () => model);

    expect(resolved).toBe(model);
  });

  it("throws when model resolution fails", () => {
    expect(() => resolveModelOrThrow(createAgent(), () => undefined)).toThrow(
      'Unknown model for agent "default": faux/faux-1',
    );
  });

  it("applies configured overrides to a resolved built-in model", () => {
    const resolved = resolveConfiguredModel(
      {
        provider: "openai",
        modelId: "gpt-5.4",
        baseUrl: "http://pc:1234/v1",
        contextWindow: 262144,
        maxTokens: 32768,
      },
      () =>
        ({
          id: "gpt-5.4",
          name: "GPT-5.4",
          api: "openai-responses",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          input: ["text", "image"],
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 200000,
          maxTokens: 100000,
        }) as never,
    );

    expect(resolved).toMatchObject({
      id: "gpt-5.4",
      baseUrl: "http://pc:1234/v1",
      contextWindow: 262144,
      maxTokens: 32768,
    });
  });

  it("builds a custom model when no built-in model exists", () => {
    const resolved = resolveConfiguredModel(
      {
        provider: "openai",
        modelId: "qwen/qwen3-coder-next",
        api: "openai-responses",
        baseUrl: "http://pc:1234/v1",
        reasoning: false,
        input: ["text"],
        contextWindow: 262144,
        maxTokens: 32768,
      },
      () => undefined,
    );

    expect(resolved).toEqual({
      id: "qwen/qwen3-coder-next",
      name: "qwen/qwen3-coder-next",
      api: "openai-responses",
      provider: "openai",
      baseUrl: "http://pc:1234/v1",
      reasoning: false,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 262144,
      maxTokens: 32768,
    });
  });
});

function createAgent(): Pick<AgentDefinition, "id" | "model"> {
  return {
    id: "default",
    model: {
      provider: "faux",
      modelId: "faux-1",
    },
  };
}
