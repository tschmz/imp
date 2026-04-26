import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNoRunningInstance, writeRuntimeState } from "./runtime-state.js";

describe("runtime-state", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats EPERM during pid probe as an already running process", async () => {
    const fixture = await createRuntimeStateFixture(43210);
    vi.spyOn(process, "kill").mockImplementation((() => {
      const error = new Error("operation not permitted") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    }) as typeof process.kill);

    await expect(assertNoRunningInstance(fixture.runtimeStatePath)).rejects.toThrow(
      "Another daemon instance is already running with pid 43210.",
    );

    await fixture.cleanup();
  });

  it("keeps the running-instance error message for a reachable foreign pid", async () => {
    const fixture = await createRuntimeStateFixture(54321);
    vi.spyOn(process, "kill").mockImplementation((() => true) as typeof process.kill);

    await expect(assertNoRunningInstance(fixture.runtimeStatePath)).rejects.toThrow(
      "Another daemon instance is already running with pid 54321.",
    );

    await fixture.cleanup();
  });
});

async function createRuntimeStateFixture(pid: number): Promise<{
  runtimeStatePath: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "imp-runtime-state-test-"));
  const runtimeStatePath = join(root, "runtime-state.json");

  await writeRuntimeState(runtimeStatePath, {
    pid,
    endpointId: "private-telegram",
    startedAt: "2026-04-07T12:00:00.000Z",
    configPath: "/tmp/config.json",
    logFilePath: "/tmp/imp.log",
  });

  return {
    runtimeStatePath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
