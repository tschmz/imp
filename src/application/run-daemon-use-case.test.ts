import { describe, expect, it, vi } from "vitest";
import type { DaemonConfig } from "../daemon/types.js";
import { createRunDaemonUseCase } from "./run-daemon-use-case.js";

describe("createRunDaemonUseCase", () => {
  it("returns started when daemon startup succeeds", async () => {
    const runtimeConfig = createRuntimeConfig();
    const createTransport = vi.fn();
    const report = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    const createDaemon = vi.fn(() => ({ start }));
    const useCase = createRunDaemonUseCase({
      resolveRuntimeTarget: async () => ({ configPath: "/tmp/config.json", runtimeConfig, createTransport }),
      createDaemon,
      startupFailureReporter: { report },
    });

    const outcome = await useCase({ configPath: "/tmp/config.json" });

    expect(outcome).toEqual({ status: "started" });
    expect(start).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    expect(createDaemon).toHaveBeenCalledWith(runtimeConfig, { createTransport });
  });

  it("returns startup_failed and delegates reporting when daemon startup fails", async () => {
    const runtimeConfig = createRuntimeConfig();
    const createTransport = vi.fn();
    const startupError = new Error("boom");
    const report = vi.fn(async () => undefined);
    const createDaemon = vi.fn(() => ({
      start: async () => {
        throw startupError;
      },
    }));
    const useCase = createRunDaemonUseCase({
      resolveRuntimeTarget: async () => ({ configPath: "/tmp/config.json", runtimeConfig, createTransport }),
      createDaemon,
      startupFailureReporter: { report },
    });

    const outcome = await useCase({ configPath: "/tmp/config.json" });

    expect(outcome).toEqual({
      status: "startup_failed",
      error: startupError,
      failedBotIds: ["endpoint-1"],
    });
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ runtimeConfig, error: startupError });
    expect(createDaemon).toHaveBeenCalledWith(runtimeConfig, { createTransport });
  });
});

function createRuntimeConfig(): DaemonConfig {
  return {
    configPath: "/tmp/config.json",
    logging: {
      level: "info",
      rotationSize: "5M",
    },
    agents: [
      {
        id: "default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
      },
    ],
    activeEndpoints: [
      {
        id: "endpoint-1",
        type: "telegram",
        token: "123:abc",
        allowedUserIds: [],
        defaultAgentId: "default",
        paths: {
          dataRoot: "/tmp",
          sessionsDir: "/tmp/sessions",
          bindingsDir: "/tmp/bindings",
          logsDir: "/tmp/logs",
          logFilePath: "/tmp/logs/endpoints.log",
          runtimeDir: "/tmp/runtime/endpoints",
          runtimeStatePath: "/tmp/runtime/endpoints/endpoint-1.json",
        },
      },
    ],
  };
}
