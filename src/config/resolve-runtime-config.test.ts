import { describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "./resolve-runtime-config.js";
import type { AppConfig } from "./types.js";

describe("resolveRuntimeConfig", () => {
  it("maps a single enabled telegram bot into daemon runtime config", () => {
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
          systemPrompt: "You are the configured default agent.",
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
          routing: {
            defaultAgentId: "ops-agent",
          },
        },
      ],
    });

    const result = resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.configPath).toBe("/etc/imp/config.json");
    expect(result.defaultAgentId).toBe("ops-agent");
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
        systemPrompt: "You are the configured default agent.",
      },
    ]);
    expect(result.activeBot).toEqual({
      id: "private-telegram",
      type: "telegram",
      token: "telegram-token",
      allowedUserIds: ["42"],
    });
    expect(result.paths).toEqual({
      dataRoot: "/var/lib/imp",
      botRoot: "/var/lib/imp/bots/private-telegram",
      conversationsDir: "/var/lib/imp/bots/private-telegram/conversations",
      logsDir: "/var/lib/imp/bots/private-telegram/logs",
      logFilePath: "/var/lib/imp/bots/private-telegram/logs/daemon.log",
      runtimeDir: "/var/lib/imp/bots/private-telegram/runtime",
      runtimeStatePath: "/var/lib/imp/bots/private-telegram/runtime/daemon.json",
    });
  });

  it("uses the global default agent id when the bot has no routing override", () => {
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

    const result = resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.defaultAgentId).toBe("default-agent");
  });

  it("resolves relative context file paths against the config directory", () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          context: {
            workingDirectory: "./workspace",
            files: ["./AGENTS.md", "/opt/shared/README.md"],
          },
          tools: ["read", "bash"],
          systemPrompt: "You are concise.",
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

    const result = resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.context).toEqual({
      workingDirectory: "/etc/imp/workspace",
      files: ["/etc/imp/AGENTS.md", "/opt/shared/README.md"],
    });
    expect(result.agents[0]?.tools).toEqual(["read", "bash"]);
  });

  it("fails when no bot is enabled", () => {
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

    expect(() => resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).toThrowError(
      "Config must enable at least one bot.",
    );
  });

  it("fails when more than one bot is enabled", () => {
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

    expect(() => resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).toThrowError(
      "Current runtime supports only one enabled bot.",
    );
  });
});

function createAppConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    instance: {
      name: "test",
    },
    paths: {
      dataRoot: "/var/lib/imp",
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
        systemPrompt: "You are concise.",
      },
    ],
    bots: overrides.bots ?? [],
  };
}
