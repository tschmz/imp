import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceOperationError } from "./service-error.js";
import { restartService, startService, statusService, stopService } from "./manage-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("manageService", () => {
  it("returns not_installed when service definition is missing", async () => {
    const root = await createTempDir();

    await expect(
      startService({
        platform: "linux",
        homeDir: root,
        configPath: join(root, ".config", "imp", "config.json"),
      }),
    ).rejects.toMatchObject({ code: "not_installed" });
  });

  it("returns structured capability results for linux operations", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");

    await createServiceDefinition(definitionPath);

    const installer = {
      async run() {},
      async runAndCapture() {
        return { stdout: "active\n", stderr: "" };
      },
    };

    await expect(
      startService({ platform: "linux", homeDir: root, configPath: join(root, ".config", "imp", "config.json"), installer }),
    ).resolves.toMatchObject({ operation: "start", platform: "linux-systemd-user", definitionPath });

    await expect(
      stopService({ platform: "linux", homeDir: root, configPath: join(root, ".config", "imp", "config.json"), installer }),
    ).resolves.toMatchObject({ operation: "stop", platform: "linux-systemd-user", definitionPath });

    await expect(
      restartService({ platform: "linux", homeDir: root, configPath: join(root, ".config", "imp", "config.json"), installer }),
    ).resolves.toMatchObject({ operation: "restart", platform: "linux-systemd-user", definitionPath });

    await expect(
      statusService({ platform: "linux", homeDir: root, configPath: join(root, ".config", "imp", "config.json"), installer }),
    ).resolves.toMatchObject({ operation: "status", platform: "linux-systemd-user", definitionPath, statusOutput: "active" });
  });

  it("reports unsupported capability on windows", async () => {
    await expect(
      statusService({
        platform: "win32",
        configPath: "C:/Users/tester/.config/imp/config.json",
      }),
    ).rejects.toBeInstanceOf(ServiceOperationError);
  });
});

async function createServiceDefinition(path: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "service\n", "utf8");
}

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-service-manage-test-"));
  tempDirs.push(path);
  return path;
}
