import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonConfig } from "../daemon/types.js";
import { readRecentLogLines, resolveLogTargets, viewDaemonLogs } from "./view-logs.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("viewDaemonLogs", () => {
  it("prints the latest lines for a single endpoint", async () => {
    const root = await createTempDir();
    const runtimeConfig = createRuntimeConfig(root, ["private-telegram"]);
    const stdout = new PassThrough();

    await writeLog(runtimeConfig.activeEndpoints[0]!.paths.logFilePath, ["one", "two", "three"]);

    const chunks: string[] = [];
    stdout.on("data", (chunk) => {
      chunks.push(String(chunk));
    });

    await viewDaemonLogs({
      runtimeConfig,
      lines: 2,
      stdout,
    });

    expect(chunks.join("")).toBe("two\nthree\n");
  });

  it("prefixes output when multiple endpoints are enabled", async () => {
    const root = await createTempDir();
    const runtimeConfig = createRuntimeConfig(root, ["private-telegram", "ops-telegram"]);
    const stdout = new PassThrough();

    await writeLog(runtimeConfig.activeEndpoints[0]!.paths.logFilePath, ["one", "two"]);
    await writeLog(runtimeConfig.activeEndpoints[1]!.paths.logFilePath, ["three", "four"]);

    const chunks: string[] = [];
    stdout.on("data", (chunk) => {
      chunks.push(String(chunk));
    });

    await viewDaemonLogs({
      runtimeConfig,
      lines: 1,
      stdout,
    });

    expect(chunks.join("")).toBe("[private-telegram] two\n[ops-telegram] four\n");
  });

  it("filters to a selected endpoint", () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram", "ops-telegram"]);

    expect(resolveLogTargets(runtimeConfig, "ops-telegram")).toEqual([
      {
        endpointId: "ops-telegram",
        logFilePath: "/tmp/log-targets/logs/endpoints/ops-telegram.log",
      },
    ]);
  });

  it("rejects an unknown endpoint selection", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);

    await expect(
      viewDaemonLogs({
        runtimeConfig,
        endpointId: "ops-telegram",
      }),
    ).rejects.toThrow("Unknown endpoint ID: ops-telegram");
  });

  it("rejects non-positive line counts", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);

    await expect(
      viewDaemonLogs({
        runtimeConfig,
        lines: 0,
      }),
    ).rejects.toThrow("`--lines` must be a positive integer.");
  });

  it("follows appended log lines", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    const abortController = new AbortController();
    let readCount = 0;

    stdout.on("data", (chunk) => {
      chunks.push(String(chunk));
    });

    setTimeout(() => {
      abortController.abort();
    }, 10);

    await viewDaemonLogs({
      runtimeConfig,
      follow: true,
      stdout,
      signal: abortController.signal,
      dependencies: {
        async readFile() {
          readCount += 1;
          if (readCount <= 1) {
            return "one\n";
          }

          return "one\ntwo\n";
        },
        watch(_path, options) {
          return (async function* watchEvents() {
            yield { eventType: "change" };
            await new Promise((resolve) => {
              options.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
            });
          })();
        },
      },
    });

    expect(chunks.join("")).toBe("one\ntwo\n");
  });

  it("does not miss log lines appended between the initial read and the first watch event", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    const abortController = new AbortController();
    let readCount = 0;

    stdout.on("data", (chunk) => {
      chunks.push(String(chunk));
    });

    setTimeout(() => {
      abortController.abort();
    }, 10);

    await viewDaemonLogs({
      runtimeConfig,
      follow: true,
      stdout,
      signal: abortController.signal,
      dependencies: {
        async readFile() {
          readCount += 1;
          if (readCount === 1) {
            return "one\n";
          }

          return "one\ntwo\n";
        },
        watch(_path, options) {
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  await new Promise((resolve) => {
                    options.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
                  });

                  return {
                    done: true,
                    value: undefined,
                  };
                },
              };
            },
          };
        },
      },
    });

    expect(chunks.join("")).toBe("one\ntwo\n");
  });

  it("continues following lines after log truncate", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);
    const stdout = new PassThrough();
    const chunks: string[] = [];
    const abortController = new AbortController();
    let readCount = 0;

    stdout.on("data", (chunk) => {
      chunks.push(String(chunk));
    });

    setTimeout(() => {
      abortController.abort();
    }, 10);

    await viewDaemonLogs({
      runtimeConfig,
      follow: true,
      stdout,
      signal: abortController.signal,
      dependencies: {
        async readFile() {
          readCount += 1;
          if (readCount <= 1) {
            return "one\ntwo\n";
          }

          return "three\n";
        },
        watch(_path, options) {
          return (async function* watchEvents() {
            yield { eventType: "change" };
            await new Promise((resolve) => {
              options.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
            });
          })();
        },
      },
    });

    expect(chunks.join("")).toBe("one\ntwo\nthree\n");
  });

  it("returns cleanly after abort when a watcher only settles via return()", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);
    const abortController = new AbortController();
    let returnCalls = 0;

    const watchTask = viewDaemonLogs({
      runtimeConfig,
      follow: true,
      stdout: new PassThrough(),
      signal: abortController.signal,
      dependencies: {
        async readFile() {
          return "one\n";
        },
        watch() {
          let closed = false;
          let resolveNext: ((result: IteratorResult<{ eventType: string }>) => void) | undefined;

          return {
            [Symbol.asyncIterator]() {
              return this;
            },
            async next() {
              if (closed) {
                return {
                  done: true,
                  value: undefined,
                };
              }

              return await new Promise<IteratorResult<{ eventType: string }>>((resolve) => {
                resolveNext = resolve;
              });
            },
            async return() {
              closed = true;
              returnCalls += 1;
              resolveNext?.({
                done: true,
                value: undefined,
              });
              return {
                done: true,
                value: undefined,
              };
            },
          } satisfies AsyncIterableIterator<{ eventType: string }>;
        },
      },
    });

    abortController.abort();

    await expect(watchTask).resolves.toBeUndefined();
    expect(returnCalls).toBe(1);
  });
});

describe("readRecentLogLines", () => {
  it("reads the newest lines from a log file", async () => {
    const root = await createTempDir();
    const logFilePath = join(root, "daemon.log");

    await writeLog(logFilePath, ["one", "two", "three"]);

    await expect(readRecentLogLines(logFilePath, 2)).resolves.toEqual(["two", "three"]);
  });

  it("returns a clear error when the log file is missing", async () => {
    await expect(readRecentLogLines("/tmp/missing-daemon.log", 5)).rejects.toThrow(
      "Log file not found: /tmp/missing-daemon.log",
    );
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-view-logs-test-"));
  tempDirs.push(path);
  return path;
}

function createRuntimeConfig(root: string, endpointIds: string[]): DaemonConfig {
  return {
    configPath: join(root, "config.json"),
    logging: {
      level: "info",
    },
    agents: [],
    activeEndpoints: endpointIds.map((endpointId) => ({
      id: endpointId,
      type: "telegram",
      token: "token",
      allowedUserIds: [],
      defaultAgentId: "default",
      paths: {
        dataRoot: root,
        conversationsDir: join(root, "endpoints", endpointId, "conversations"),
        logsDir: join(root, "logs", "endpoints"),
        logFilePath: join(root, "logs", "endpoints", `${endpointId}.log`),
        runtimeDir: join(root, "runtime", "endpoints"),
        runtimeStatePath: join(root, "runtime", "endpoints", `${endpointId}.json`),
      },
    })),
  };
}

async function writeLog(path: string, lines: string[]): Promise<void> {
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}
