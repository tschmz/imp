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

  it("accepts agents without a prompt definition", () => {
    const result = appConfigSchema.safeParse(
      createConfig({
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts custom model definitions for OpenAI-compatible endpoints", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "local-lms",
        model: {
          provider: "openai",
          modelId: "qwen/qwen3-coder-next",
          api: "openai-responses",
          baseUrl: "http://pc:1234/v1",
          reasoning: false,
          input: ["text"],
          contextWindow: 262144,
          maxTokens: 32768,
        },
      }),
      defaults: {
        agentId: "local-lms",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts configs without explicit endpoints", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      endpoints: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts file endpoints with explicit plugin configuration and endpoint response routing", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      plugins: [
        {
          id: "pi-audio",
          enabled: true,
          package: {
            path: "/opt/imp/plugins/pi-audio",
            command: "node",
            args: ["server.js"],
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "replace-me",
          access: {
            allowedUserIds: [],
          },
        },
        {
          id: "audio-ingress",
          type: "file",
          enabled: true,
          pluginId: "pi-audio",
          ingress: {
            pollIntervalMs: 250,
            maxEventBytes: 65536,
          },
          response: {
            type: "endpoint",
            endpointId: "private-telegram",
            target: {
              conversationId: "123456789",
            },
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts plugin outbox response routing with an explicit reply channel kind", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      plugins: [
        {
          id: "pi-audio",
          enabled: true,
        },
      ],
      endpoints: [
        {
          id: "audio-ingress",
          type: "file",
          enabled: true,
          pluginId: "pi-audio",
          response: {
            type: "outbox",
            replyChannel: {
              kind: "audio",
            },
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects plugin outbox response routing without an explicit reply channel kind", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      plugins: [
        {
          id: "pi-audio",
          enabled: true,
        },
      ],
      endpoints: [
        {
          id: "audio-ingress",
          type: "file",
          enabled: true,
          pluginId: "pi-audio",
          response: {
            type: "outbox",
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
        path: ["endpoints", 0, "response", "replyChannel"],
        message: "Invalid input: expected object, received undefined",
      }),
    );
  });

  it("allows file endpoints to reference automatically discovered plugins", () => {
    const result = appConfigSchema.safeParse({
      ...createConfig({
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      }),
      plugins: [],
      endpoints: [
        {
          id: "audio-ingress",
          type: "file",
          enabled: true,
          pluginId: "pi-audio",
          response: {
            type: "none",
          },
        },
      ],
    });

    expect(result.success).toBe(true);
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

  it("accepts agent skill catalogs", () => {
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
        skills: {
          paths: ["./skills", "/opt/imp/skills"],
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects deprecated endpoint skill catalogs", () => {
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
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          skills: {
            paths: ["./skills"],
          },
          token: "replace-me",
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
        path: ["endpoints", 0],
      }),
    );
  });

  it("accepts global MCP stdio server config referenced by agents", () => {
    const result = appConfigSchema.safeParse(
      {
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
          tools: {
            builtIn: ["read"],
            mcp: {
              servers: ["echo"],
            },
          },
        }),
        tools: {
          mcp: {
            inheritEnv: ["OPENAI_API_KEY"],
            servers: [
              {
                id: "echo",
                command: "node",
                args: ["./server.mjs"],
                inheritEnv: ["GITHUB_TOKEN"],
                cwd: "./tools",
                env: {
                  MODE: "test",
                },
              },
            ],
          },
        },
      },
    );

    expect(result.success).toBe(true);
  });

  it("accepts explicit delegated agent tools under agents.tools.agents", () => {
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
        tools: {
          agents: [
            {
              agentId: "helper",
            },
            {
              agentId: "writer",
              toolName: "draft_copy",
              description: "Ask the writer agent for draft copy.",
            },
          ],
        },
      }),
      agents: [
        {
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
            agents: [
              {
                agentId: "helper",
              },
              {
                agentId: "writer",
                toolName: "draft_copy",
                description: "Ask the writer agent for draft copy.",
              },
            ],
          },
        },
        {
          id: "helper",
          prompt: {
            base: {
              text: "You help.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
        },
        {
          id: "writer",
          prompt: {
            base: {
              text: "You write.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects delegated agent tools that reference unknown agents", () => {
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
        tools: {
          agents: [
            {
              agentId: "missing",
            },
          ],
        },
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["agents", 0, "tools", "agents", 0, "agentId"],
        message: 'Unknown delegated agent id "missing" for agent "default". Expected one of: "default".',
      }),
    );
  });

  it("rejects self-delegation", () => {
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
        tools: {
          agents: [
            {
              agentId: "default",
            },
          ],
        },
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["agents", 0, "tools", "agents", 0, "agentId"],
        message: 'Agent "default" cannot delegate to itself.',
      }),
    );
  });

  it("accepts allowlisted phone call config under agents.tools.phone", () => {
    const result = appConfigSchema.safeParse(
      {
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
          tools: {
            mcp: {
              servers: ["imp-phone"],
            },
            phone: {
              contacts: [
                {
                  id: "office",
                  name: "Office",
                  uri: "sip:+491234567@example.com",
                  comment: "work colleague",
                },
              ],
            },
          },
        }),
        tools: {
          mcp: {
            servers: [
              {
                id: "imp-phone",
                command: "node",
                args: ["bin/mcp-server.mjs"],
              },
            ],
          },
        },
      },
    );

    expect(result.success).toBe(true);
  });

  it("rejects duplicate phone contact ids for a single agent", () => {
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
          phone: {
            contacts: [
              {
                id: "office",
                name: "Office",
                uri: "sip:+491234567@example.com",
              },
              {
                id: "office",
                name: "Office duplicate",
                uri: "sip:+499999999@example.com",
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
        path: ["agents", 0, "tools", "phone", "contacts", 1, "id"],
        message: 'Duplicate phone contact id "office". Phone contact ids must be unique per agent.',
      }),
    );
  });

  it("rejects duplicate global MCP server ids", () => {
    const result = appConfigSchema.safeParse(
      {
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
      },
    );

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["tools", "mcp", "servers", 1, "id"],
        message: 'Duplicate MCP server id "echo". MCP server ids must be unique.',
      }),
    );
  });

  it("rejects unknown MCP server references for an agent", () => {
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
            servers: ["missing"],
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
        path: ["agents", 0, "tools", "mcp", "servers", 0],
        message: 'Unknown MCP server id "missing" for agent "default".',
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
      endpoints: [
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

  it("accepts telegram document download config", () => {
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
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "replace-me",
          access: {
            allowedUserIds: [],
          },
          document: {
            maxDownloadBytes: 1048576,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid telegram document download limits", () => {
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
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "replace-me",
          access: {
            allowedUserIds: [],
          },
          document: {
            maxDownloadBytes: 0,
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects endpoint ids that are unsafe as path segments", () => {
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
      endpoints: [
        {
          id: "../ops",
          type: "telegram",
          enabled: true,
          token: "replace-me",
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
        path: ["endpoints", 0, "id"],
        message: "Endpoint ids may only contain letters, numbers, hyphens, and underscores.",
      }),
    );
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
      endpoints: [
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
      endpoints: [
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
      endpoints: [
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
        path: ["endpoints", 0, "token"],
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
    endpoints: [
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
