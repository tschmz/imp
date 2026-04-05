import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileLogger } from "./file-logger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("createFileLogger", () => {
  it("suppresses info logs when level is set to warn", async () => {
    const logFilePath = await createLogFilePath();
    const consoleInfo = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createFileLogger(logFilePath, "warn");

    await logger.info("hidden");

    await expect(readFile(logFilePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("keeps error logs when level is set to warn", async () => {
    const logFilePath = await createLogFilePath();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createFileLogger(logFilePath, "warn");

    await logger.error("visible");

    await expect(readFile(logFilePath, "utf8")).resolves.toContain('"message":"visible"');
    expect(consoleError).toHaveBeenCalledWith("visible");
  });
});

async function createLogFilePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "imp-logger-test-"));
  tempDirs.push(root);
  return join(root, "daemon.log");
}
