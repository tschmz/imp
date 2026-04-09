import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appConfigSchema } from "./schema.js";
import { resolveRuntimeConfig } from "./resolve-runtime-config.js";
import type { AppConfig } from "./types.js";

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
  it("maps enabled telegram bots into daemon runtime config", async () => {
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
      bots: [
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
    expect(result.activeBots).toEqual([
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
          botRoot: "/var/lib/imp/bots/private-telegram",
          conversationsDir: "/var/lib/imp/bots/private-telegram/conversations",
          logsDir: "/var/lib/imp/bots/private-telegram/logs",
          logFilePath: "/var/lib/imp/bots/private-telegram/logs/daemon.log",
          runtimeDir: "/var/lib/imp/bots/private-telegram/runtime",
          runtimeStatePath: "/var/lib/imp/bots/private-telegram/runtime/daemon.json",
        },
      },
    ]);
  });

  it("uses the global default agent id when the bot has no routing override", async () => {
    const appConfig = createAppConfig({
      defaults: {
        agentId: "default-agent",
      },
      bots: [
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

    expect(result.activeBots[0]?.defaultAgentId).toBe("default-agent");
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
      bots: [
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
      bots: [
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

  it("fails when no bot is enabled", async () => {
    const appConfig = createAppConfig({
      bots: [
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
      "Config must enable at least one bot.",
    );
  });

  it("keeps more than one enabled bot", async () => {
    const appConfig = createAppConfig({
      bots: [
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

    expect(result.activeBots.map((bot) => bot.id)).toEqual([
      "private-telegram",
      "ops-telegram",
    ]);
  });

  it("defaults logging level to info when logging config is omitted", async () => {
    const appConfig = createAppConfig({
      logging: undefined,
      bots: [
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

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json", {
      env: {
        IMP_TELEGRAM_BOT_TOKEN: "telegram-from-env",
      },
    });

    expect(result.activeBots[0]?.token).toBe("telegram-from-env");
  });

  it("resolves telegram token file references relative to the config file", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "imp.json");
    const secretPath = join(root, "config", "secrets", "telegram.token");
    await writeRawFile(secretPath, "telegram-from-file\n");

    const appConfig = createAppConfig({
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

    const result = await resolveRuntimeConfig(appConfig, configPath);

    expect(result.activeBots[0]?.token).toBe("telegram-from-file");
  });

  it("fails when a telegram token env reference is missing", async () => {
    const appConfig = createAppConfig({
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

    await expect(resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).rejects.toThrowError(
      "bots.private-telegram.token references environment variable IMP_TELEGRAM_BOT_TOKEN, but it is not set.",
    );
  });

  it("rejects defaults.agentId when it does not reference a configured agent", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        defaults: {
          agentId: "missing-agent",
        },
        bots: [
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

  it("rejects bots.routing.defaultAgentId when it does not reference a configured agent", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        bots: [
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

    expectSchemaIssue(result, ["bots", 0, "routing", "defaultAgentId"], [
      'Unknown default agent id "missing-agent" for bot "private-telegram".',
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
        bots: [
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

  it("rejects duplicate bot ids", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        bots: [
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

    expectSchemaIssue(result, ["bots", 1, "id"], [
      'Duplicate bot id "private-telegram".',
      "Bot ids must be unique.",
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
    bots: overrides.bots ?? [],
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
