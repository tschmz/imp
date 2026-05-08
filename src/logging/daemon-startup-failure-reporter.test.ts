import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonConfig, RuntimePaths } from "../daemon/types.js";
import type { Logger } from "./types.js";
import { createDaemonStartupFailureReporter } from "./daemon-startup-failure-reporter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("createDaemonStartupFailureReporter", () => {
  it("uses configured rotation size and closes startup failure loggers", async () => {
    const root = await createTempDir();
    const logger = createMockLogger();
    const createLogger = vi.fn(() => logger);
    const reporter = createDaemonStartupFailureReporter({ createLogger });
    const error = new Error("startup failed");

    await reporter.report({
      runtimeConfig: createRuntimeConfig(root),
      error,
    });

    expect(createLogger).toHaveBeenCalledWith(
      join(root, "logs", "endpoints.log"),
      "debug",
      { rotationSize: "1K" },
    );
    expect(logger.error).toHaveBeenCalledWith(
      "daemon failed to start",
      { endpointId: "private-telegram" },
      error,
    );
    expect(logger.close).toHaveBeenCalledOnce();
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-startup-failure-reporter-test-"));
  tempDirs.push(path);
  return path;
}

function createRuntimeConfig(root: string): DaemonConfig {
  const paths = createRuntimePaths(root);
  return {
    configPath: join(root, "config.json"),
    logging: {
      level: "debug",
      rotationSize: "1K",
    },
    agents: [],
    activeEndpoints: [{
      id: "private-telegram",
      type: "telegram",
      token: "telegram-token",
      allowedUserIds: ["7"],
      defaultAgentId: "default",
      paths,
    }],
  };
}

function createRuntimePaths(root: string): RuntimePaths {
  return {
    dataRoot: root,
    sessionsDir: join(root, "sessions"),
    bindingsDir: join(root, "bindings"),
    logsDir: join(root, "logs"),
    logFilePath: join(root, "logs", "endpoints.log"),
    runtimeDir: join(root, "runtime", "endpoints"),
    runtimeStatePath: join(root, "runtime", "endpoints", "private-telegram.json"),
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(async () => undefined),
    info: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}
