import { mkdtemp, readFile, stat } from "node:fs/promises";
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
    expect(stdout).toContain("init");
    expect(stdout).toContain("service");
    expect(stdout).toContain("--version");
  });

  it("shows help output for service install", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["service", "install", "--help"], env);

    expect(stdout).toContain("Usage: imp service install");
    expect(stdout).toContain("--config <path>");
    expect(stdout).toContain("--dry-run");
  });

  it("shows command-specific config help for start", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["start", "--help"], env);

    expect(stdout).toContain("Usage: imp start");
    expect(stdout).toContain("--config <path>");
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
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      paths: { dataRoot: string };
      agents: Array<{ id: string }>;
      bots: Array<{ access: { allowedUserIds: string[] } }>;
    };

    expect(stdout).toContain(`Created config at ${configPath}`);
    expect(config.paths.dataRoot).toBe(join(root, "state-home", "imp"));
    expect(config.agents[0]?.id).toBe("default");
    expect(config.bots[0]?.access.allowedUserIds).toEqual([]);
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
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(root, "config-home"),
    XDG_STATE_HOME: join(root, "state-home"),
  };
}

async function overwriteConfig(path: string, config: unknown): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function writeRuntimeState(path: string, state: unknown): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
