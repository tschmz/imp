import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  it("fails when the service definition does not exist", async () => {
    await expect(assertServiceDefinitionExists("/tmp/imp-missing.service")).rejects.toThrowError(
      "Service definition not found: /tmp/imp-missing.service",
    );
  });

  it("removes a linux user service definition", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    const result = await uninstallService({
      platform: "linux-systemd-user",
      definitionPath,
      serviceName: "imp",
      serviceLabel: "dev.imp",
      installer: {
        async run(command, args) {
          calls.push({ command, args });
        },
      },
    });

    expect(result.definitionPath).toBe(definitionPath);
    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "disable", "--now", "imp.service"] },
      { command: "systemctl", args: ["--user", "daemon-reload"] },
    ]);
    await expect(readFile(definitionPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes a macOS launch agent definition", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, "Library", "LaunchAgents", "dev.imp.plist");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    await uninstallService({
      platform: "macos-launchd-agent",
      definitionPath,
      serviceName: "imp",
      serviceLabel: "dev.imp",
      uid: 501,
      installer: {
        async run(command, args) {
          calls.push({ command, args });
        },
      },
    });

    expect(calls).toEqual([
      { command: "launchctl", args: ["bootout", "gui/501", definitionPath] },
    ]);
    await expect(readFile(definitionPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects automatic windows uninstallation for now", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, "imp.xml");
    await createServiceDefinition(definitionPath);

    await expect(
      uninstallService({
        platform: "windows-winsw",
        definitionPath,
        serviceName: "imp",
        serviceLabel: "dev.imp",
      }),
    ).rejects.toThrowError("Automatic Windows service uninstallation is not implemented yet.");
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
