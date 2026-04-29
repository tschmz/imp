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
  it("applies log-level filtering to file and console output", async () => {
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const debugLogFilePath = await createLogFilePath();
    const debugLogger = trackLogger(createFileLogger(debugLogFilePath, "debug"));
    await debugLogger.debug("visible-debug");

    const debugContent = await readFile(debugLogFilePath, "utf8");
    expect(debugContent).toContain('"level":"debug"');
    expect(debugContent).toContain('"schemaVersion":1');
    expect(debugContent).toContain('"event":"visible.debug"');
    expect(consoleDebug).toHaveBeenCalledWith("visible-debug");

    const infoLogFilePath = await createLogFilePath();
    const infoLogger = trackLogger(createFileLogger(infoLogFilePath, "info"));
    await infoLogger.debug("hidden-debug");

    await expect(readFile(infoLogFilePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(consoleDebug).not.toHaveBeenCalledWith("hidden-debug");

    const warnLogFilePath = await createLogFilePath();
    const warnLogger = trackLogger(createFileLogger(warnLogFilePath, "warn"));
    await warnLogger.info("hidden");
    await warnLogger.error("visible");

    const warnContent = await readFile(warnLogFilePath, "utf8");
    expect(warnContent).toContain('"message":"visible"');
    expect(warnContent).not.toContain('"message":"hidden"');
    expect(consoleInfo).not.toHaveBeenCalled();
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
