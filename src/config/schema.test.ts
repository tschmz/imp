import { describe, expect, it } from "vitest";
import { appConfigSchema } from "./schema.js";

describe("appConfigSchema", () => {
  it("rejects authFile for non-OAuth providers", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        systemPrompt: "You are concise.",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        authFile: "/tmp/auth.json",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["agents", 0, "authFile"],
        message: "`authFile` is not supported for provider `openai`.",
      }),
    );
  });

  it("rejects authFile when no provider is configured", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        systemPrompt: "You are concise.",
        authFile: "/tmp/auth.json",
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["agents", 0, "authFile"],
        message: "`authFile` requires `model.provider` to be set to an OAuth-capable provider.",
      }),
    );
  });

  it("accepts authFile for OAuth-capable providers", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        systemPrompt: "You are concise.",
        model: {
          provider: "openai-codex",
          modelId: "gpt-5.4",
        },
        authFile: "/tmp/auth.json",
      }),
    );

    expect(result.success).toBe(true);
  });
});

function createConfig(agent: Record<string, unknown>) {
  return {
    instance: {
      name: "default",
    },
    paths: {
      dataRoot: "/tmp/imp",
    },
    defaults: {
      agentId: "default",
    },
    agents: [agent],
    bots: [
      {
        id: "private-telegram",
        type: "telegram",
        enabled: true,
        token: "replace-me",
        access: {
          allowedUserIds: [],
        },
      },
    ],
  };
}
