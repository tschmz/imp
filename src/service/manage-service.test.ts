import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("fails for all operations when service definition is missing", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "missing.service");

    const operations = [
      () =>
        startService({
          platform: "linux-systemd-user",
          definitionPath,
          serviceName: "imp",
          serviceLabel: "dev.imp",
        }),
      () =>
        stopService({
          platform: "linux-systemd-user",
          definitionPath,
          serviceName: "imp",
          serviceLabel: "dev.imp",
        }),
      () =>
        restartService({
          platform: "linux-systemd-user",
          definitionPath,
          serviceName: "imp",
          serviceLabel: "dev.imp",
        }),
      () =>
        statusService({
          platform: "linux-systemd-user",
          definitionPath,
          serviceName: "imp",
          serviceLabel: "dev.imp",
        }),
    ];

    await Promise.all(
      operations.map(async (operation) => {
        await expect(operation()).rejects.toThrow(`Service definition not found: ${definitionPath}`);
      }),
    );
  });
  it("starts a linux user service", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    await startService({
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

    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "start", "imp.service"] },
    ]);
  });

  it("stops a linux user service", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    await stopService({
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

    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "stop", "imp.service"] },
    ]);
  });

  it("restarts a linux user service", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    await restartService({
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

    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "restart", "imp.service"] },
    ]);
  });

  it("reads the status of a linux user service", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    const output = await statusService({
      platform: "linux-systemd-user",
      definitionPath,
      serviceName: "imp",
      serviceLabel: "dev.imp",
      installer: {
        async run() {
          throw new Error("not used");
        },
        async runAndCapture(command, args) {
          calls.push({ command, args });
          return {
            stdout: "active\n",
            stderr: "",
          };
        },
      },
    });

    expect(output).toBe("active");
    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "status", "--no-pager", "imp.service"] },
    ]);
  });

  it("starts and restarts a macOS launch agent", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, "Library", "LaunchAgents", "dev.imp.plist");
    const startCalls: Array<{ command: string; args: string[] }> = [];
    const restartCalls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    await startService({
      platform: "macos-launchd-agent",
      definitionPath,
      serviceName: "imp",
      serviceLabel: "dev.imp",
      uid: 501,
      installer: {
        async run(command, args) {
          startCalls.push({ command, args });
          if (args[0] === "bootstrap") {
            throw new Error("already loaded");
          }
        },
      },
    });

    await restartService({
      platform: "macos-launchd-agent",
      definitionPath,
      serviceName: "imp",
      serviceLabel: "dev.imp",
      uid: 501,
      installer: {
        async run(command, args) {
          restartCalls.push({ command, args });
          if (args[0] === "kickstart") {
            throw new Error("kickstart not needed");
          }
        },
      },
    });

    expect(startCalls).toEqual([
      { command: "launchctl", args: ["bootstrap", "gui/501", definitionPath] },
      { command: "launchctl", args: ["kickstart", "-k", "gui/501/dev.imp"] },
    ]);
    expect(restartCalls).toEqual([
      { command: "launchctl", args: ["bootout", "gui/501", definitionPath] },
      { command: "launchctl", args: ["bootstrap", "gui/501", definitionPath] },
      { command: "launchctl", args: ["kickstart", "-k", "gui/501/dev.imp"] },
    ]);
  });

  it("stops a macOS launch agent", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, "Library", "LaunchAgents", "dev.imp.plist");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    await stopService({
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
  });

  it("reads the status of a macOS launch agent", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, "Library", "LaunchAgents", "dev.imp.plist");
    const calls: Array<{ command: string; args: string[] }> = [];

    await createServiceDefinition(definitionPath);

    const output = await statusService({
      platform: "macos-launchd-agent",
      definitionPath,
      serviceName: "imp",
      serviceLabel: "dev.imp",
      uid: 501,
      installer: {
        async run() {
          throw new Error("not used");
        },
        async runAndCapture(command, args) {
          calls.push({ command, args });
          return {
            stdout: "state = running\n",
            stderr: "",
          };
        },
      },
    });

    expect(output).toBe("state = running");
    expect(calls).toEqual([
      { command: "launchctl", args: ["print", "gui/501/dev.imp"] },
    ]);
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
