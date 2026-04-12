import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertServiceInstallCanProceed,
  installService,
  resolveServiceDefinitionPath,
} from "./install-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("installService", () => {
  it("resolves the systemd user unit path", () => {
    expect(
      resolveServiceDefinitionPath({
        platform: "linux-systemd-user",
        homeDir: "/home/tester",
        serviceName: "imp",
        serviceLabel: "dev.imp",
      }),
    ).toBe("/home/tester/.config/systemd/user/imp.service");
  });

  it("resolves the launchd plist path", () => {
    expect(
      resolveServiceDefinitionPath({
        platform: "macos-launchd-agent",
        homeDir: "/Users/tester",
        serviceName: "imp",
        serviceLabel: "dev.imp",
      }),
    ).toBe("/Users/tester/Library/LaunchAgents/dev.imp.plist");
  });

  it("writes and activates a linux user service", async () => {
    const root = await createTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];
    const configPath = join(root, ".config", "imp", "config.json");

    const result = await installService({
      platform: "linux",
      homeDir: root,
      configPath,
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      installer: {
        async run(command, args) {
          calls.push({ command, args });
        },
      },
    });

    expect(result.operation.definitionPath).toBe(join(root, ".config", "systemd", "user", "imp.service"));
    expect(result.environmentPath).toBe(join(root, ".config", "imp", "service.env"));
    await expect(readFile(result.operation.definitionPath, "utf8")).resolves.toContain("ExecStart=");
    await expect(readFile(result.operation.definitionPath, "utf8")).resolves.toContain(
      `EnvironmentFile="${join(root, ".config", "imp", "service.env")}"`,
    );
    await expect(readFile(join(root, ".config", "imp", "service.env"), "utf8")).resolves.toBe("\n");
    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", "imp.service"] },
      { command: "systemctl", args: ["--user", "restart", "imp.service"] },
    ]);
  });

  it("writes explicit service environment variables into the linux environment file", async () => {
    const root = await createTempDir();
    const configPath = join(root, ".config", "imp", "config.json");

    const result = await installService({
      platform: "linux",
      homeDir: root,
      configPath,
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      serviceEnvironment: {
        OPENAI_API_KEY: "sk-test",
      },
      installer: {
        async run() {},
      },
    });

    await expect(readFile(result.environmentPath!, "utf8")).resolves.toContain('OPENAI_API_KEY="sk-test"');
  });

  it("writes and activates a macOS launch agent", async () => {
    const root = await createTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await installService({
      platform: "darwin",
      homeDir: root,
      uid: 501,
      configPath: join(root, ".config", "imp", "config.json"),
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      installer: {
        async run(command, args) {
          calls.push({ command, args });
          if (args[0] === "bootout") {
            throw new Error("not loaded");
          }
        },
      },
    });

    expect(result.operation.definitionPath).toBe(join(root, "Library", "LaunchAgents", "dev.imp.plist"));
    await expect(readFile(result.operation.definitionPath, "utf8")).resolves.toContain("<plist version=\"1.0\">");
    expect(calls).toEqual([
      {
        command: "launchctl",
        args: ["bootout", "gui/501", join(root, "Library", "LaunchAgents", "dev.imp.plist")],
      },
      {
        command: "launchctl",
        args: ["bootstrap", "gui/501", join(root, "Library", "LaunchAgents", "dev.imp.plist")],
      },
      {
        command: "launchctl",
        args: ["kickstart", "-k", "gui/501/dev.imp"],
      },
    ]);
  });

  it("rejects automatic windows installation for now", async () => {
    await expect(
      installService({
        platform: "win32",
        homeDir: "C:/Users/tester",
        configPath: "C:/Users/tester/.config/imp/config.json",
      }),
    ).rejects.toThrowError("Automatic Windows service installation is not implemented yet.");
  });

  it("refuses to overwrite an existing service definition without force", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");

    await installService({
      platform: "linux",
      homeDir: root,
      configPath: join(root, ".config", "imp", "config.json"),
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      installer: {
        async run() {},
      },
    });

    await expect(assertServiceInstallCanProceed({ definitionPath })).rejects.toThrowError(
      `Service definition already exists: ${definitionPath}\nRe-run with --force to overwrite.`,
    );
  });

  it("refuses to overwrite an existing linux environment file without force", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");
    const environmentPath = join(root, ".config", "imp", "service.env");

    await mkdir(join(root, ".config", "imp"), { recursive: true });
    await writeFile(environmentPath, "OPENAI_API_KEY=sk-test\n", "utf8");

    await expect(assertServiceInstallCanProceed({ definitionPath, environmentPath })).rejects.toThrowError(
      `Service environment file already exists: ${environmentPath}\nRe-run with --force to overwrite.`,
    );
  });

  it("allows overwriting an existing service definition with force", async () => {
    const root = await createTempDir();
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");

    await installService({
      platform: "linux",
      homeDir: root,
      configPath: join(root, ".config", "imp", "config.json"),
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      installer: {
        async run() {},
      },
    });

    await expect(assertServiceInstallCanProceed({ definitionPath, force: true })).resolves.toBe(
      definitionPath,
    );
  });

  it("creates backups before overwriting existing linux service files with force", async () => {
    const root = await createTempDir();
    const configPath = join(root, ".config", "imp", "config.json");
    const definitionPath = join(root, ".config", "systemd", "user", "imp.service");
    const environmentPath = join(root, ".config", "imp", "service.env");
    const definitionBackupPath = `${definitionPath}.2026-04-05T19-30-00.000Z.bak`;
    const environmentBackupPath = `${environmentPath}.2026-04-05T19-30-00.000Z.bak`;

    await installService({
      platform: "linux",
      homeDir: root,
      configPath,
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      installer: {
        async run() {},
      },
    });
    const originalDefinitionContent = await readFile(definitionPath, "utf8");
    const originalEnvironmentContent = await readFile(environmentPath, "utf8");

    await installService({
      platform: "linux",
      homeDir: root,
      configPath,
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      installer: {
        async run() {},
      },
      force: true,
      now: new Date("2026-04-05T19:30:00.000Z"),
    });

    await expect(readFile(definitionBackupPath, "utf8")).resolves.toBe(originalDefinitionContent);
    await expect(readFile(environmentBackupPath, "utf8")).resolves.toBe(originalEnvironmentContent);
  });

  it("preserves existing custom environment variables when reinstalling with force", async () => {
    const root = await createTempDir();
    const configPath = join(root, ".config", "imp", "config.json");
    const environmentPath = join(root, ".config", "imp", "service.env");

    await installService({
      platform: "linux",
      homeDir: root,
      configPath,
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      serviceEnvironment: {
        OPENAI_API_KEY: "sk-original",
      },
      installer: {
        async run() {},
      },
    });

    await installService({
      platform: "linux",
      homeDir: root,
      configPath,
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/app/dist/main.js"],
      installer: {
        async run() {},
      },
      force: true,
      now: new Date("2026-04-05T19:30:00.000Z"),
    });

    await expect(readFile(environmentPath, "utf8")).resolves.toContain('OPENAI_API_KEY="sk-original"');
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-service-test-"));
  tempDirs.push(path);
  return path;
}
