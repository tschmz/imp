import { describe, expect, it, vi } from "vitest";
import type { DaemonConfig } from "../daemon/types.js";
import { AgentExecutionError, ConfigError } from "../domain/errors.js";
import { createRunDaemonUseCase } from "./run-daemon-use-case.js";

describe("createRunDaemonUseCase", () => {
  it("returns started when daemon startup succeeds", async () => {
    const runtimeConfig = createRuntimeConfig();
    const report = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    const useCase = createRunDaemonUseCase({
      resolveRuntimeTarget: async () => ({ configPath: "/tmp/config.json", runtimeConfig }),
      createDaemon: () => ({ start }),
      startupFailureReporter: { report },
    });

    const outcome = await useCase({ configPath: "/tmp/config.json" });

    expect(outcome).toEqual({ ok: true, value: { status: "started" } });
    expect(start).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });

  it("returns startup_failed and delegates reporting when daemon startup fails", async () => {
    const runtimeConfig = createRuntimeConfig();
    const startupError = new Error("boom");
    const report = vi.fn(async () => undefined);
    const useCase = createRunDaemonUseCase({
      resolveRuntimeTarget: async () => ({ configPath: "/tmp/config.json", runtimeConfig }),
      createDaemon: () => ({
        start: async () => {
          throw startupError;
        },
      }),
      startupFailureReporter: { report },
    });

    const outcome = await useCase({ configPath: "/tmp/config.json" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("Expected error outcome");
    }
    expect(outcome.error).toBeInstanceOf(AgentExecutionError);
    expect(outcome.error.details).toEqual({ failedBotIds: ["bot-1"] });
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ runtimeConfig, error: outcome.error });
  });

  it("preserves resolve runtime target failure message in config errors", async () => {
    const report = vi.fn(async () => undefined);
    const useCase = createRunDaemonUseCase({
      resolveRuntimeTarget: async () => {
        throw new Error("No config found in /etc/imp/config.json");
      },
      createDaemon: () => ({ start: vi.fn(async () => undefined) }),
      startupFailureReporter: { report },
    });

    const outcome = await useCase({ configPath: "/etc/imp/config.json" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("Expected error outcome");
    }
    expect(outcome.error).toBeInstanceOf(ConfigError);
    expect(outcome.error.message).toBe("No config found in /etc/imp/config.json");
    expect(outcome.error.details).toEqual({
      configPath: "/etc/imp/config.json",
      originalMessage: "No config found in /etc/imp/config.json",
    });
    expect(report).not.toHaveBeenCalled();
  });
});

function createRuntimeConfig(): DaemonConfig {
  return {
    configPath: "/tmp/config.json",
    logging: {
      level: "info",
    },
    agents: [
      {
        id: "default",
      },
    ],
    activeBots: [
      {
        id: "bot-1",
        type: "telegram",
        token: "123:abc",
        allowedUserIds: [],
        defaultAgentId: "default",
        paths: {
          dataRoot: "/tmp",
          botRoot: "/tmp/bot-1",
          conversationsDir: "/tmp/bot-1/conversations",
          logsDir: "/tmp/bot-1/logs",
          logFilePath: "/tmp/bot-1/logs/daemon.log",
          runtimeDir: "/tmp/bot-1/runtime",
          runtimeStatePath: "/tmp/bot-1/runtime/daemon.json",
        },
      },
    ],
  };
}
