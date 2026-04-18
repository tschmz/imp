import { mkdtemp, readFile, stat } from "node:fs/promises";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const tempDirs: string[] = [];
const projectRoot = resolveProjectRoot();
const cliEntryPoint = join(projectRoot, "dist", "main.js");

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("imp CLI e2e", () => {
  it("shows help output when no command is given", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli([], env);

    expect(stdout).toContain("Usage: imp");
    expect(stdout).toContain("start");
    expect(stdout).toContain("init");
    expect(stdout).toContain("backup");
    expect(stdout).toContain("restore");
    expect(stdout).toContain("plugin");
    expect(stdout).toContain("service");
  });

  it("shows version output", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["--version"], env);

    expect(stdout.trim()).toBe(packageJson.version);
  });

  it("creates a default config through `imp init --defaults`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["init", "--defaults"], env);
    const configPath = join(root, "config-home", "imp", "config.json");
    const environmentPath = join(root, "config-home", "imp", "service.env");
    const servicePath =
      process.platform === "darwin"
        ? join(root, "Library", "LaunchAgents", "dev.imp.plist")
        : process.platform === "linux"
          ? join(root, ".config", "systemd", "user", "imp.service")
          : null;
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      paths: { dataRoot: string };
      agents: Array<{ id: string; prompt?: { base?: { file?: string } } }>;
      endpoints: unknown[];
    };

    expect(stdout).toContain(`Created config at ${configPath}`);
    if (servicePath) {
      expect(stdout).not.toContain(`Installed`);
      await expect(stat(servicePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    if (process.platform === "linux") {
      await expect(readFile(environmentPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    expect(config.paths.dataRoot).toBe(join(root, "state-home", "imp"));
    expect(config.agents[0]?.id).toBe("default");
    expect(config.agents[0]?.prompt).toBeUndefined();
    expect(config.endpoints).toEqual([]);
    await expect(readFile(join(root, "state-home", "imp", "SYSTEM.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, "state-home", "imp", "skills", "imp-skill-creator", "SKILL.md"), "utf8"),
    ).resolves.toContain(`global skills live under \`${join(root, "state-home", "imp", "skills")}\``);
  });

  it("creates and restores a backup with config, agent files, and conversations", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const backupPath = join(root, "backup.tar");
    const promptPath = join(dataRoot, "SYSTEM.md");
    const authPath = join(dataRoot, "auth.json");
    const conversationPath = join(dataRoot, "conversations", "agents", "default", "sessions", "session-1", "conversation.json");

    await runCli(["init", "--defaults"], env);
    await overwriteConfig(configPath, {
      instance: {
        name: "default",
      },
      paths: {
        dataRoot,
      },
      logging: {
        level: "info",
      },
      defaults: {
        agentId: "default",
      },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai-codex",
            modelId: "gpt-5.4",
          },
          authFile: authPath,
          prompt: {
            base: {
              file: promptPath,
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "test-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });
    await writeTextFile(promptPath, "backup prompt\n");
    await writeTextFile(authPath, '{"token":"secret"}\n');
    await writeTextFile(conversationPath, '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"hi"}]}]}\n');

    const backupResult = await runCli(["backup", "create", "--config", configPath, "--output", backupPath], env);

    expect(backupResult.stdout).toContain(`Created backup at ${backupPath}`);

    await overwriteConfig(configPath, {
      instance: { name: "mutated" },
      paths: { dataRoot },
      logging: { level: "warn" },
      defaults: { agentId: "default" },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai-codex",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              text: "mutated",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "changed-token",
          access: { allowedUserIds: [] },
        },
      ],
    });
    await writeTextFile(promptPath, "mutated prompt\n");
    await writeTextFile(authPath, '{"token":"changed"}\n');
    await writeTextFile(conversationPath, '{"messages":[]}\n');

    const restoreResult = await runCli(["restore", backupPath, "--config", configPath, "--force"], env);

    expect(restoreResult.stdout).toContain(`Restored backup from ${backupPath}`);
    expect(await readFile(configPath, "utf8")).toContain('"token": "test-token"');
    expect(await readFile(promptPath, "utf8")).toBe("backup prompt\n");
    expect(await readFile(authPath, "utf8")).toBe('{"token":"secret"}\n');
    expect(await readFile(conversationPath, "utf8")).toContain('"hi"');
  }, 10_000);

  it("updates a discovered config value through `imp config set` using array id navigation", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await runCli(["init", "--defaults"], env);
    await overwriteConfig(configPath, {
      instance: {
        name: "default",
      },
      paths: {
        dataRoot: join(root, "state-home", "imp"),
      },
      logging: {
        level: "info",
      },
      defaults: {
        agentId: "default",
      },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const { stdout } = await runCli(["config", "set", "--config", configPath, "endpoints.private-telegram.enabled", "false"], env);
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      endpoints: Array<{ id: string; enabled: boolean }>;
    };

    expect(stdout).toBe(`Updated config ${configPath}: endpoints.private-telegram.enabled\n`);
    expect(config.endpoints.find((endpoint) => endpoint.id === "private-telegram")?.enabled).toBe(false);
  }, 10_000);

  it("prints a native service definition in dry-run mode", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    const configPath = join(root, "config-home", "imp", "config.json");

    const { stdout } = await runCli(["service", "install", "--config", configPath, "--dry-run"], env);

    switch (process.platform) {
      case "linux":
        expect(stdout).toContain("[Unit]");
        expect(stdout).toContain("ExecStart=");
        break;
      case "darwin":
        expect(stdout).toContain("<plist version=\"1.0\">");
        expect(stdout).toContain("<key>ProgramArguments</key>");
        break;
      case "win32":
        expect(stdout).toContain("<service>");
        expect(stdout).toContain("<executable>");
        break;
      default:
        throw new Error(`Unsupported test platform: ${process.platform}`);
    }
  });

  it("creates runtime directories and logs a startup failure for an invalid telegram token", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");
    const dataRoot = join(root, "state-home", "imp");

    await runCli(["init", "--defaults"], env);
    await overwriteConfig(configPath, {
      instance: {
        name: "default",
      },
      paths: {
        dataRoot,
      },
      logging: {
        level: "info",
      },
      defaults: {
        agentId: "default",
      },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "invalid-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    await expect(runCli(["start", "--config", configPath], env)).rejects.toSatisfy((error: { stderr?: string }) => {
      const stderr = error.stderr ?? "";
      return (
        stderr.includes('Invalid Telegram endpoint token for endpoint "private-telegram"') ||
        stderr.includes("Network request for 'getMe' failed")
      );
    });

    const logFilePath = join(dataRoot, "logs", "endpoints", "private-telegram.log");
    const runtimeStatePath = join(dataRoot, "runtime", "endpoints", "private-telegram.json");

    await expect(stat(join(dataRoot, "logs", "endpoints"))).resolves.toBeDefined();
    await expect(stat(join(dataRoot, "runtime", "endpoints"))).resolves.toBeDefined();
    await expect(stat(join(dataRoot, "endpoints"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(logFilePath, "utf8")).resolves.toContain(
      "daemon failed to start",
    );
    await expect(stat(runtimeStatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("shows recent daemon log lines", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");
    const logFilePath = join(root, "state-home", "imp", "logs", "endpoints", "private-telegram.log");

    await runCli(["init", "--defaults"], env);
    await overwriteConfig(configPath, {
      instance: {
        name: "default",
      },
      paths: {
        dataRoot: join(root, "state-home", "imp"),
      },
      logging: {
        level: "info",
      },
      defaults: {
        agentId: "default",
      },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "123456:valid-format-but-invalid-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });
    await writeLogFile(logFilePath, ["one", "two", "three"]);

    const { stdout } = await runCli(["log", "--config", configPath, "--lines", "2"], env);

    expect(stdout).toBe("two\nthree\n");
  });

  it("rejects non-interactive init without --defaults", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await expect(runCli(["init"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "`imp init` requires an interactive terminal. Re-run with --defaults to skip prompts.",
      ),
    });
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-e2e-test-"));
  tempDirs.push(path);
  return path;
}

function createTestEnv(root: string): NodeJS.ProcessEnv {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });

  if (process.platform === "linux") {
    const systemctlPath = join(binDir, "systemctl");
    writeFileSync(
      systemctlPath,
      "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$IMP_TEST_SERVICE_LOG\"\nif [[ \"$2\" == \"status\" ]]; then\n  printf 'imp.service - imp daemon\\n'\nfi\n",
      "utf8",
    );
    chmodSync(systemctlPath, 0o755);
  }

  if (process.platform === "darwin") {
    const launchctlPath = join(binDir, "launchctl");
    writeFileSync(
      launchctlPath,
      "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$IMP_TEST_SERVICE_LOG\"\nif [[ \"$1\" == \"print\" ]]; then\n  printf 'state = running\\n'\nfi\n",
      "utf8",
    );
    chmodSync(launchctlPath, 0o755);
  }

  return {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: join(root, "config-home"),
    XDG_STATE_HOME: join(root, "state-home"),
    IMP_CONFIG_PATH: "",
    IMP_TEST_SERVICE_LOG: join(root, "service-manager.log"),
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
}

async function overwriteConfig(path: string, config: unknown): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function writeLogFile(path: string, lines: string[]): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

async function writeTextFile(path: string, content: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [cliEntryPoint, ...args], {
    cwd: projectRoot,
    env,
  });
}

function resolveProjectRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
