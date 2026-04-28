import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileLogger, createFileOnlyLogger, prepareLogFile } from "./file-logger.js";
import type { Logger } from "./types.js";

const tempDirs: string[] = [];
const openLoggers: Logger[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openLoggers.splice(0).map((logger) => logger.close?.()));
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("createFileLogger", () => {
  it("writes debug logs when level is set to debug", async () => {
    const logFilePath = await createLogFilePath();
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logger = trackLogger(createFileLogger(logFilePath, "debug"));

    await logger.debug("visible-debug");

    const content = await readFile(logFilePath, "utf8");
    expect(content).toContain('"level":"debug"');
    expect(content).toContain('"schemaVersion":1');
    expect(content).toContain('"event":"visible.debug"');
    expect(consoleDebug).toHaveBeenCalledWith("visible-debug");
  });

  it("suppresses debug logs when level is set to info", async () => {
    const logFilePath = await createLogFilePath();
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logger = trackLogger(createFileLogger(logFilePath, "info"));

    await logger.debug("hidden-debug");

    await expect(readFile(logFilePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(consoleDebug).not.toHaveBeenCalled();
  });

  it("suppresses info logs when level is set to warn", async () => {
    const logFilePath = await createLogFilePath();
    const consoleInfo = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = trackLogger(createFileLogger(logFilePath, "warn"));

    await logger.info("hidden");

    await expect(readFile(logFilePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("keeps error logs when level is set to warn", async () => {
    const logFilePath = await createLogFilePath();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = trackLogger(createFileLogger(logFilePath, "warn"));

    await logger.error("visible");

    await expect(readFile(logFilePath, "utf8")).resolves.toContain('"message":"visible"');
    expect(consoleError).toHaveBeenCalledWith("visible");
  });

  it("can write logs without writing to the console", async () => {
    const logFilePath = await createLogFilePath();
    const consoleInfo = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = trackLogger(createFileOnlyLogger(logFilePath, "debug"));

    await logger.info("visible-info");
    await logger.error("visible-error", undefined, new Error("boom"));

    const content = await readFile(logFilePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(content).toContain('"message":"visible-info"');
    expect(content).toContain('"message":"visible-error"');
    expect(content).toContain('"error":{"type":"Error","message":"boom"');
    expect(content).toContain("Error: boom");
    expect(consoleInfo).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("prepares an existing daemon log without rotating or truncating it", async () => {
    const logFilePath = await createLogFilePath();
    await writeFile(logFilePath, "older run\n", "utf8");

    await prepareLogFile(logFilePath);

    await expect(readFile(logFilePath, "utf8")).resolves.toBe("older run\n");
    await expect(readFile(`${logFilePath}.1`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("creates an empty daemon log without rotation when the current file is missing", async () => {
    const logFilePath = await createLogFilePath();

    await prepareLogFile(logFilePath);

    await expect(readFile(logFilePath, "utf8")).resolves.toBe("");
    await expect(readFile(`${logFilePath}.1`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rotates logs only after the configured size is reached", async () => {
    const logFilePath = await createLogFilePath();
    const logger = trackLogger(createFileOnlyLogger(logFilePath, "info", { rotationSize: "1K" }));

    await logger.info("first");
    await expect(readFile(`${logFilePath}.1`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    for (let index = 0; index < 30; index += 1) {
      await logger.info("large log line", { component: `component-${index}-${"x".repeat(100)}` });
    }

    await expect(readFile(`${logFilePath}.1`, "utf8")).resolves.toContain('"message":"large log line"');
    await expect(readFile(logFilePath, "utf8")).resolves.toContain('"message":"large log line"');
  });
});

async function createLogFilePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "imp-logger-test-"));
  tempDirs.push(root);
  return join(root, "daemon.log");
}

function trackLogger<T extends Logger>(logger: T): T {
  openLoggers.push(logger);
  return logger;
}
