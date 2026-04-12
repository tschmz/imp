import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { appConfigSchema } from "./schema.js";
import { resolveRuntimeConfig } from "./resolve-runtime-config.js";
import type { AppConfig } from "./types.js";
import { registerTransport } from "../transports/registry.js";

type RegisterTransportEntry = Parameters<typeof registerTransport>[1];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("resolveRuntimeConfig", () => {
  it("maps enabled telegram endpoints into daemon runtime config", async () => {
    const appConfig = createAppConfig({
      defaults: {
        agentId: "default-agent",
      },
      agents: [
        {
          id: "default-agent",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          inference: {
            metadata: {
              app: "imp",
            },
            request: {
              store: true,
            },
          },
          tools: ["read"],
          prompt: {
            base: {
              text: "You are the configured default agent.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: ["42"],
          },
          voice: {
            enabled: true,
            transcription: {
              provider: "openai",
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
          },
          routing: {
            defaultAgentId: "ops-agent",
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.configPath).toBe("/etc/imp/config.json");
    expect(result.logging).toEqual({
      level: "info",
    });
    expect(result.agents).toEqual([
      {
        id: "default-agent",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        inference: {
          metadata: {
            app: "imp",
          },
          request: {
            store: true,
          },
        },
        tools: ["read"],
        prompt: {
          base: {
            text: "You are the configured default agent.",
          },
        },
      },
    ]);
    expect(result.activeEndpoints).toEqual([
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["42"],
        voice: {
          enabled: true,
          transcription: {
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
            language: "en",
          },
        },
        defaultAgentId: "ops-agent",
        paths: {
          dataRoot: "/var/lib/imp",
          endpointRoot: "/var/lib/imp/endpoints/private-telegram",
          conversationsDir: "/var/lib/imp/endpoints/private-telegram/conversations",
          logsDir: "/var/lib/imp/logs/endpoints",
          logFilePath: "/var/lib/imp/logs/endpoints/private-telegram.log",
          runtimeDir: "/var/lib/imp/runtime/endpoints",
          runtimeStatePath: "/var/lib/imp/runtime/endpoints/private-telegram.json",
        },
      },
    ]);
  });

  it("discovers valid agent skills from configured paths", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "imp.json");
    const skillsPath = join(root, "config", "skills");
    await writeRawFile(
      join(skillsPath, "commit", "SKILL.md"),
      ["---", "name: commit", "description: Stage and commit changes.", "---", "", "Use focused commits."].join("\n"),
    );

    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          inference: {
            metadata: {
              app: "imp",
            },
            request: {
              store: true,
            },
          },
          tools: [],
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          skills: {
            paths: ["./skills"],
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, configPath);

    expect(result.agents[0]?.skills).toEqual({
      paths: [skillsPath],
    });
    expect(result.agents[0]?.skillCatalog).toHaveLength(1);
    expect(result.agents[0]?.skillCatalog?.[0]).toMatchObject({
      name: "commit",
      description: "Stage and commit changes.",
      filePath: join(skillsPath, "commit", "SKILL.md"),
    });
    expect(result.agents[0]?.skillIssues ?? []).toEqual([]);
  });

  it("uses the built-in default prompt when no prompt base is configured", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          tools: [],
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.prompt).toEqual({
      base: {
        builtIn: "default",
      },
    });
  });

  it("uses the global default agent id when the endpoint has no routing override", async () => {
    const appConfig = createAppConfig({
      defaults: {
        agentId: "default-agent",
      },
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.activeEndpoints[0]?.defaultAgentId).toBe("default-agent");
  });

  it("resolves relative prompt and workspace paths against the config directory", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              file: "./prompts/default.md",
            },
            instructions: [{ file: "./AGENTS.md" }],
            references: [{ file: "/opt/shared/README.md" }],
          },
          workspace: {
            cwd: "./workspace",
          },
          tools: ["read", "bash"],
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.prompt).toEqual({
      base: { file: "/etc/imp/prompts/default.md" },
      instructions: [{ file: "/etc/imp/AGENTS.md" }],
      references: [{ file: "/opt/shared/README.md" }],
    });
    expect(result.agents[0]?.workspace).toEqual({
      cwd: "/etc/imp/workspace",
    });
    expect(result.agents[0]?.tools).toEqual(["read", "bash"]);
  });

  it("resolves MCP server cwd relative to the config directory", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          tools: {
            builtIn: ["read"],
            mcp: {
              servers: [
                {
                  id: "echo",
                  command: "node",
                  args: ["./server.mjs"],
                  cwd: "./mcp",
                },
              ],
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.tools).toEqual(["read"]);
    expect(result.agents[0]?.mcp).toEqual({
      servers: [
        {
          id: "echo",
          command: "node",
          args: ["./server.mjs"],
          cwd: "/etc/imp/mcp",
        },
      ],
    });
  });

  it("resolves a relative agent auth file path against the config directory", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          authFile: "./auth.json",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.authFile).toBe("/etc/imp/auth.json");
  });

  it("fails when no endpoint is enabled", async () => {
    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: false,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    await expect(resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).rejects.toThrowError(
      "Config must enable at least one endpoint.",
    );
  });

  it("keeps more than one enabled endpoint", async () => {
    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
        {
          id: "ops-telegram",
          type: "telegram",
          enabled: true,
          token: "ops-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.activeEndpoints.map((endpoint) => endpoint.id)).toEqual([
      "private-telegram",
      "ops-telegram",
    ]);
  });

  it("defaults logging level to info when logging config is omitted", async () => {
    const appConfig = createAppConfig({
      logging: undefined,
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.logging.level).toBe("info");
  });

  it("resolves telegram token env references", async () => {
    const appConfig = createAppConfig({
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

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json", {
      env: {
        IMP_TELEGRAM_BOT_TOKEN: "telegram-from-env",
      },
    });

    expect(result.activeEndpoints[0]?.token).toBe("telegram-from-env");
  });

  it("resolves telegram token file references relative to the config file", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "imp.json");
    const secretPath = join(root, "config", "secrets", "telegram.token");
    await writeRawFile(secretPath, "telegram-from-file\n");

    const appConfig = createAppConfig({
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

    const result = await resolveRuntimeConfig(appConfig, configPath);

    expect(result.activeEndpoints[0]?.token).toBe("telegram-from-file");
  });

  it("fails when a telegram token env reference is missing", async () => {
    const appConfig = createAppConfig({
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

    await expect(resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).rejects.toThrowError(
      "endpoints.private-telegram.token references environment variable IMP_TELEGRAM_BOT_TOKEN, but it is not set.",
    );
  });

  it("does not resolve token secrets for transports that do not define a token field", async () => {
    const transportType = "test-notoken";
    registerTransport(transportType, {
      configSchema: z.object({
        id: z.string().min(1),
        type: z.literal(transportType),
        enabled: z.boolean(),
      }),
      createTransport: () => {
        throw new Error("Not used in this test.");
      },
      normalizeRuntimeConfig: (endpoint: unknown, context: unknown) => {
        const typedBot = endpoint as { id: string; type: string };
        const typedContext = context as {
          dataRoot: string;
          defaultAgentId: string;
        };

        return {
          id: typedBot.id,
          type: typedBot.type,
        token: "runtime-token-not-required",
        allowedUserIds: [],
        defaultAgentId: typedContext.defaultAgentId,
        paths: {
          dataRoot: typedContext.dataRoot,
          endpointRoot: "/var/lib/imp/endpoints/no-token",
          conversationsDir: "/var/lib/imp/endpoints/no-token/conversations",
          logsDir: "/var/lib/imp/logs/endpoints",
          logFilePath: "/var/lib/imp/logs/endpoints/no-token.log",
          runtimeDir: "/var/lib/imp/runtime/endpoints",
          runtimeStatePath: "/var/lib/imp/runtime/endpoints/no-token.json",
        },
      };
      },
    } as unknown as RegisterTransportEntry);

    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "no-token",
          type: transportType,
          enabled: true,
        } as unknown as AppConfig["endpoints"][number],
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");
    expect(result.activeEndpoints[0]?.id).toBe("no-token");
    expect(result.activeEndpoints[0]?.type).toBe(transportType);
  });

  it("rejects defaults.agentId when it does not reference a configured agent", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        defaults: {
          agentId: "missing-agent",
        },
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["defaults", "agentId"], [
      'Unknown default agent id "missing-agent".',
      'Expected one of: "default".',
    ]);
  });

  it("rejects endpoints.routing.defaultAgentId when it does not reference a configured agent", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
            routing: {
              defaultAgentId: "missing-agent",
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["endpoints", 0, "routing", "defaultAgentId"], [
      'Unknown default agent id "missing-agent" for endpoint "private-telegram".',
      'Expected one of: "default".',
    ]);
  });

  it("rejects duplicate agent ids", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        agents: [
          {
            id: "default",
            model: {
              provider: "openai",
              modelId: "gpt-5.4",
            },
            prompt: {
              base: {
                text: "You are concise.",
              },
            },
          },
          {
            id: "default",
            model: {
              provider: "openai",
              modelId: "gpt-5.4",
            },
            prompt: {
              base: {
                text: "You are also concise.",
              },
            },
          },
        ],
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["agents", 1, "id"], [
      'Duplicate agent id "default".',
      "Agent ids must be unique.",
    ]);
  });

  it("rejects duplicate endpoint ids", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "other-telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["endpoints", 1, "id"], [
      'Duplicate endpoint id "private-telegram".',
      "Endpoint ids must be unique.",
    ]);
  });
});

function createAppConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    instance: {
      name: "test",
    },
    paths: {
      dataRoot: "/var/lib/imp",
      ...overrides.paths,
    },
    logging: {
      level: "info",
    },
    defaults: {
      agentId: "default",
      ...overrides.defaults,
    },
    agents: overrides.agents ?? [
      {
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        inference: {
          metadata: {
            app: "imp",
          },
          request: {
            store: true,
          },
        },
        tools: [],
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
      },
    ],
    endpoints: overrides.endpoints ?? [],
  };
}

function expectSchemaIssue(
  result: ReturnType<typeof appConfigSchema.safeParse>,
  path: Array<string | number>,
  messageParts: string[],
): void {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected schema validation to fail.");
  }

  const issue = result.error.issues.find(
    (candidate) =>
      candidate.path.length === path.length &&
      candidate.path.every((segment, index) => segment === path[index]),
  );

  expect(issue).toBeDefined();
  for (const part of messageParts) {
    expect(issue?.message).toContain(part);
  }
}

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-resolve-runtime-config-test-"));
  tempDirs.push(path);
  return path;
}

async function writeRawFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
