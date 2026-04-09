import { describe, expect, it } from "vitest";
import { appConfigSchema } from "./schema.js";

describe("appConfigSchema", () => {
  it("rejects authFile for non-OAuth providers", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
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
        prompt: {
          base: {
            text: "You are concise.",
          },
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
        message: "`authFile` requires `model.provider` to be set to an OAuth-capable provider.",
      }),
    );
  });

  it("accepts authFile for OAuth-capable providers", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai-codex",
          modelId: "gpt-5.4",
        },
        authFile: "/tmp/auth.json",
      }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects agents without a prompt definition", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["agents", 0, "prompt"],
        message: "Invalid input: expected object, received undefined",
      }),
    );
  });

  it("rejects agents without a model", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["agents", 0, "model"],
        message: "Agent model is required.",
      }),
    );
  });

  it("accepts agent shell path entries in workspace", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        workspace: {
          cwd: "/workspace",
          shellPath: ["/home/tester/.local/bin", "/usr/bin", "/bin"],
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts MCP stdio server config under agents.tools.mcp.servers", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        tools: {
          builtIn: ["read"],
          mcp: {
            servers: [
              {
                id: "echo",
                command: "node",
                args: ["./server.mjs"],
                cwd: "./tools",
                env: {
                  MODE: "test",
                },
              },
            ],
          },
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects duplicate MCP server ids for a single agent", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        tools: {
          mcp: {
            servers: [
              {
                id: "echo",
                command: "node",
              },
              {
                id: "echo",
                command: "node",
              },
            ],
          },
        },
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["agents", 0, "tools", "mcp", "servers", 1, "id"],
        message: 'Duplicate MCP server id "echo". MCP server ids must be unique per agent.',
      }),
    );
  });

  it("accepts telegram voice transcription config", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "replace-me",
          access: {
            allowedUserIds: [],
          },
          voice: {
            enabled: true,
            transcription: {
              provider: "openai",
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts telegram token env references", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            env: "IMP_TELEGRAM_BOT_TOKEN",
          },
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts telegram token file references", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            file: "./secrets/telegram.token",
          },
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects telegram token references that set both env and file", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            env: "IMP_TELEGRAM_BOT_TOKEN",
            file: "./secrets/telegram.token",
          },
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["bots", 0, "token"],
        message: "Specify exactly one of env or file.",
      }),
    );
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
