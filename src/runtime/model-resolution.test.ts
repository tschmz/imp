import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import { resolveModelOrThrow } from "./model-resolution.js";

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
