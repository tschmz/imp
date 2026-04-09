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
  it("prints the latest lines for a single bot", async () => {
    const root = await createTempDir();
    const runtimeConfig = createRuntimeConfig(root, ["private-telegram"]);
    const stdout = new PassThrough();

    await writeLog(runtimeConfig.activeBots[0]!.paths.logFilePath, ["one", "two", "three"]);

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

  it("prefixes output when multiple bots are enabled", async () => {
    const root = await createTempDir();
    const runtimeConfig = createRuntimeConfig(root, ["private-telegram", "ops-telegram"]);
    const stdout = new PassThrough();

    await writeLog(runtimeConfig.activeBots[0]!.paths.logFilePath, ["one", "two"]);
    await writeLog(runtimeConfig.activeBots[1]!.paths.logFilePath, ["three", "four"]);

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

  it("filters to a selected bot", () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram", "ops-telegram"]);

    expect(resolveLogTargets(runtimeConfig, "ops-telegram")).toEqual([
      {
        botId: "ops-telegram",
        logFilePath: "/tmp/log-targets/bots/ops-telegram/logs/daemon.log",
      },
    ]);
  });

  it("rejects an unknown bot selection", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);

    await expect(
      viewDaemonLogs({
        runtimeConfig,
        botId: "ops-telegram",
      }),
    ).rejects.toThrow("Unknown bot ID: ops-telegram");
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
          if (readCount <= 2) {
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

  it("returns cleanly after abort when a watcher only settles via return()", async () => {
    const runtimeConfig = createRuntimeConfig("/tmp/log-targets", ["private-telegram"]);
    const abortController = new AbortController();
    let returnCalls = 0;

    const watchTask = viewDaemonLogs({
      runtimeConfig,
      follow: true,
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

function createRuntimeConfig(root: string, botIds: string[]): DaemonConfig {
  return {
    configPath: join(root, "config.json"),
    logging: {
      level: "info",
    },
    agents: [],
    activeBots: botIds.map((botId) => ({
      id: botId,
      type: "telegram",
      token: "token",
      allowedUserIds: [],
      defaultAgentId: "default",
      skillCatalog: [],
      skillIssues: [],
      paths: {
        dataRoot: root,
        botRoot: join(root, "bots", botId),
        conversationsDir: join(root, "bots", botId, "conversations"),
        logsDir: join(root, "bots", botId, "logs"),
        logFilePath: join(root, "bots", botId, "logs", "daemon.log"),
        runtimeDir: join(root, "bots", botId, "runtime"),
        runtimeStatePath: join(root, "bots", botId, "runtime", "daemon.json"),
      },
    })),
  };
}

async function writeLog(path: string, lines: string[]): Promise<void> {
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}
