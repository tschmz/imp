import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceOperationError } from "./service-error.js";
import {
  assertServiceDefinitionExists,
  uninstallService,
} from "./uninstall-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("uninstallService", () => {
  it("fails with not_installed when the service definition does not exist", async () => {
    await expect(assertServiceDefinitionExists("/tmp/imp-missing.service")).rejects.toMatchObject({
      code: "not_installed",
    });
  });

  it("returns a structured uninstall result and removes the service definition", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");

    await createServiceDefinition(definitionPath);

    const result = await uninstallService({
      configPath: join(root, ".config", "imp", "config.json"),
      platform: "linux",
      homeDir: root,
      installer: {
        async run() {},
      },
    });

    expect(result.operation).toMatchObject({
      operation: "uninstall",
      platform: "linux-systemd-user",
      serviceName: "imp",
      definitionPath,
    });
    await expect(readFile(definitionPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("maps windows uninstall as unsupported capability", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, "imp.xml");
    await createServiceDefinition(definitionPath);

    await expect(
      uninstallService({
        configPath: "C:/Users/tester/.config/imp/config.json",
        platform: "win32",
        homeDir: root,
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
  const path = await mkdtemp(join(tmpdir(), "imp-service-uninstall-test-"));
  tempDirs.push(path);
  return path;
}
