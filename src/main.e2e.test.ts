import { mkdtemp, readFile, stat } from "node:fs/promises";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const projectRoot = resolveProjectRoot();

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], {
    cwd: projectRoot,
    env: process.env,
  });
});

describe("imp CLI e2e", () => {
  it("shows help output when no command is given", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli([], env);

    expect(stdout).toContain("Usage: imp");
    expect(stdout).toContain("start");
    expect(stdout).toContain("init");
    expect(stdout).toContain("service");
  });

  it("shows help output", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["--help"], env);

    expect(stdout).toContain("Usage: imp");
    expect(stdout).toContain("start");
    expect(stdout).toContain("log");
    expect(stdout).toContain("config");
    expect(stdout).toContain("init");
    expect(stdout).toContain("service");
    expect(stdout).toContain("--version");
  });

  it("shows help output for config validate", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["config", "validate", "--help"], env);

    expect(stdout).toContain("Usage: imp config validate");
    expect(stdout).toContain("--config <path>");
  });

  it("shows help output for service install", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["service", "install", "--help"], env);

    expect(stdout).toContain("Usage: imp service install");
    expect(stdout).toContain("--config <path>");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--dry-run");
  });

  it("shows help output for service uninstall", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["service", "uninstall", "--help"], env);

    expect(stdout).toContain("Usage: imp service uninstall");
    expect(stdout).toContain("--config <path>");
  });

  it("shows help output for service lifecycle commands", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const startHelp = await runCli(["service", "start", "--help"], env);
    const stopHelp = await runCli(["service", "stop", "--help"], env);
    const restartHelp = await runCli(["service", "restart", "--help"], env);
    const statusHelp = await runCli(["service", "status", "--help"], env);

    expect(startHelp.stdout).toContain("Usage: imp service start");
    expect(stopHelp.stdout).toContain("Usage: imp service stop");
    expect(restartHelp.stdout).toContain("Usage: imp service restart");
    expect(statusHelp.stdout).toContain("Usage: imp service status");
  }, 10_000);

  it("shows command-specific config help for start", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["start", "--help"], env);

    expect(stdout).toContain("Usage: imp start");
    expect(stdout).toContain("--config <path>");
  });

  it("shows command-specific config help for log", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["log", "--help"], env);

    expect(stdout).toContain("Usage: imp log");
    expect(stdout).toContain("--bot <id>");
    expect(stdout).toContain("--follow");
    expect(stdout).toContain("--lines <count>");
  });

  it("shows command-specific config help for init", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["init", "--help"], env);

    expect(stdout).toContain("Usage: imp init");
    expect(stdout).toContain("--config <path>");
  });

  it("shows version output", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["--version"], env);

    expect(stdout.trim()).toBe("0.1.0");
  });

  it("creates a default config through `imp init --defaults`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["init", "--defaults"], env);
    const configPath = join(root, "config-home", "imp", "config.json");
    const promptPath = join(root, "state-home", "imp", "SYSTEM.md");
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
      agents: Array<{ id: string; systemPromptFile: string }>;
      bots: Array<{ access: { allowedUserIds: string[] } }>;
    };

    expect(stdout).toContain(`Created config at ${configPath}`);
    if (servicePath) {
      expect(stdout).toContain(`Installed`);
      await expect(stat(servicePath)).resolves.toBeDefined();
    }
    if (process.platform === "linux") {
      await expect(readFile(environmentPath, "utf8")).resolves.not.toContain("PATH=");
    }
    expect(config.paths.dataRoot).toBe(join(root, "state-home", "imp"));
    expect(config.agents[0]?.id).toBe("default");
    expect(config.agents[0]?.systemPromptFile).toBe(promptPath);
    expect(config.bots[0]?.access.allowedUserIds).toEqual([]);
    await expect(readFile(promptPath, "utf8")).resolves.toContain(
      "You are a local coding and operations assistant running through a local Imp daemon.",
    );
  });

  it("validates the discovered config through `imp config validate`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await runCli(["init", "--defaults"], env);

    const { stdout } = await runCli(["config", "validate"], env);

    expect(stdout).toBe(`Config valid: ${configPath}\n`);
  });

  it("validates an explicit config path through `imp config validate --config`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "custom", "imp.json");

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
          systemPrompt: "You are a concise and pragmatic assistant running through a local daemon.",
        },
      ],
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: false,
          token: "test-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const { stdout } = await runCli(["config", "validate", "--config", configPath], env);

    expect(stdout).toBe(`Config valid: ${configPath}\n`);
  });

  it("fails with the existing missing-config error for `imp config validate`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await expect(runCli(["config", "validate"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("No config file found."),
    });
  });

  it("fails with the existing invalid-config error for `imp config validate`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await overwriteConfig(configPath, {
      invalid: true,
    });

    await expect(runCli(["config", "validate"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Invalid config file ${configPath}`),
    });
  });

  it("copies the default provider key into the linux service environment during `imp init --defaults`", async () => {
    if (process.platform !== "linux") {
      return;
    }

    const root = await createTempDir();
    const env = {
      ...createTestEnv(root),
      OPENAI_API_KEY: "sk-test-default",
    };

    await runCli(["init", "--defaults"], env);

    await expect(readFile(join(root, "config-home", "imp", "service.env"), "utf8")).resolves.toContain(
      'OPENAI_API_KEY="sk-test-default"',
    );
  });

  it("prints a native service definition in dry-run mode", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    const { stdout } = await runCli(["service", "install", "--dry-run"], env);

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

  it("fails with a clear message for non-dry-run service install on unsupported platforms", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    await expect(runCli(["service", "install"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("Automatic Windows service installation is not implemented yet."),
    });
  });

  it("fails before installing when the service definition already exists", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    const definitionPath =
      process.platform === "darwin"
        ? join(root, "Library", "LaunchAgents", "dev.imp.plist")
        : process.platform === "linux"
          ? join(root, ".config", "systemd", "user", "imp.service")
          : null;

    if (!definitionPath) {
      return;
    }

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dirname(definitionPath), { recursive: true });
    await writeFile(definitionPath, "existing\n", "utf8");

    await expect(runCli(["service", "install"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `Service definition already exists: ${definitionPath}\nRe-run with --force to overwrite.`,
      ),
    });
  });

  it("reinstalls the service during `imp init --force` when the definition already exists", async () => {
    if (process.platform === "win32") {
      return;
    }

    const root = await createTempDir();
    const env = createTestEnv(root);
    const definitionPath =
      process.platform === "darwin"
        ? join(root, "Library", "LaunchAgents", "dev.imp.plist")
        : join(root, ".config", "systemd", "user", "imp.service");

    await runCli(["init", "--defaults"], env);

    const { writeFile } = await import("node:fs/promises");
    await writeFile(definitionPath, "existing\n", "utf8");

    const { stdout } = await runCli(["init", "--defaults", "--force"], env);

    expect(stdout).toContain("Created config at");
    expect(stdout).toContain(`Installed`);
    await expect(readFile(definitionPath, "utf8")).resolves.not.toBe("existing\n");
  });

  it("fails when service uninstall cannot find a definition", async () => {
    if (process.platform === "win32") {
      return;
    }

    const root = await createTempDir();
    const env = createTestEnv(root);
    const definitionPath =
      process.platform === "darwin"
        ? join(root, "Library", "LaunchAgents", "dev.imp.plist")
        : join(root, ".config", "systemd", "user", "imp.service");

    await expect(runCli(["service", "uninstall"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Service definition not found: ${definitionPath}`),
    });
  });

  it("fails when service lifecycle commands cannot find a definition", async () => {
    if (process.platform === "win32") {
      return;
    }

    const root = await createTempDir();
    const env = createTestEnv(root);
    const definitionPath =
      process.platform === "darwin"
        ? join(root, "Library", "LaunchAgents", "dev.imp.plist")
        : join(root, ".config", "systemd", "user", "imp.service");

    await expect(runCli(["service", "start"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Service definition not found: ${definitionPath}`),
    });
    await expect(runCli(["service", "stop"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Service definition not found: ${definitionPath}`),
    });
    await expect(runCli(["service", "restart"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Service definition not found: ${definitionPath}`),
    });
    await expect(runCli(["service", "status"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Service definition not found: ${definitionPath}`),
    });
  }, 10_000);

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
          systemPrompt:
            "You are a concise and pragmatic assistant running through a local daemon.",
        },
      ],
      bots: [
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

    await expect(runCli(["start"], env)).rejects.toSatisfy((error: { stderr?: string }) => {
      const stderr = error.stderr ?? "";
      return (
        stderr.includes('Invalid Telegram bot token for bot "private-telegram"') ||
        stderr.includes("Network request for 'getMe' failed")
      );
    });

    const botRoot = join(dataRoot, "bots", "private-telegram");
    const logFilePath = join(botRoot, "logs", "daemon.log");
    const runtimeStatePath = join(botRoot, "runtime", "daemon.json");

    await expect(stat(join(botRoot, "logs"))).resolves.toBeDefined();
    await expect(stat(join(botRoot, "runtime"))).resolves.toBeDefined();
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
    const logFilePath = join(root, "state-home", "imp", "bots", "private-telegram", "logs", "daemon.log");

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
          systemPrompt:
            "You are a concise and pragmatic assistant running through a local daemon.",
        },
      ],
      bots: [
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

    const { stdout } = await runCli(["log", "--lines", "2"], env);

    expect(stdout).toBe("two\nthree\n");
  });

  it("shows prefixed log lines when multiple bots are enabled", async () => {
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
          systemPrompt:
            "You are a concise and pragmatic assistant running through a local daemon.",
        },
      ],
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "token-1",
          access: {
            allowedUserIds: [],
          },
        },
        {
          id: "ops-telegram",
          type: "telegram",
          enabled: true,
          token: "token-2",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });
    await writeLogFile(join(dataRoot, "bots", "private-telegram", "logs", "daemon.log"), ["one", "two"]);
    await writeLogFile(join(dataRoot, "bots", "ops-telegram", "logs", "daemon.log"), ["three", "four"]);

    const { stdout } = await runCli(["log", "--lines", "1"], env);

    expect(stdout).toBe("[private-telegram] two\n[ops-telegram] four\n");
  });

  it("filters logs to a selected bot", async () => {
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
          systemPrompt:
            "You are a concise and pragmatic assistant running through a local daemon.",
        },
      ],
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "token-1",
          access: {
            allowedUserIds: [],
          },
        },
        {
          id: "ops-telegram",
          type: "telegram",
          enabled: true,
          token: "token-2",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });
    await writeLogFile(join(dataRoot, "bots", "private-telegram", "logs", "daemon.log"), ["one", "two"]);
    await writeLogFile(join(dataRoot, "bots", "ops-telegram", "logs", "daemon.log"), ["three", "four"]);

    const { stdout } = await runCli(["log", "--bot", "ops-telegram", "--lines", "1"], env);

    expect(stdout).toBe("four\n");
  });

  it("rejects a second daemon start while the first instance is still running", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const runtimeStatePath = join(
      dataRoot,
      "bots",
      "private-telegram",
      "runtime",
      "daemon.json",
    );

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
          systemPrompt:
            "You are a concise and pragmatic assistant running through a local daemon.",
        },
      ],
      bots: [
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

    await writeRuntimeState(runtimeStatePath, {
      pid: process.pid,
      botId: "private-telegram",
      startedAt: "2026-04-05T00:00:00.000Z",
      configPath,
      logFilePath: join(dataRoot, "bots", "private-telegram", "logs", "daemon.log"),
    });

    await expect(runCli(["start"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `Another daemon instance is already running with pid ${process.pid}.`,
      ),
    });
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

  it("fails before prompting when the config already exists", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await runCli(["init", "--defaults"], env);

    await expect(runCli(["init"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `Config file already exists: ${configPath}\nRe-run with --force to overwrite.`,
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
    IMP_TEST_SERVICE_LOG: join(root, "service-manager.log"),
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
}

async function overwriteConfig(path: string, config: unknown): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function writeRuntimeState(path: string, state: unknown): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function writeLogFile(path: string, lines: string[]): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("node", ["dist/main.js", ...args], {
    cwd: projectRoot,
    env,
  });
}

function resolveProjectRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
