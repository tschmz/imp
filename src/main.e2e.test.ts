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
  it("creates a default config through `imp init`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["init"], env);
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

  it("creates runtime directories and logs a startup failure for an invalid telegram token", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");
    const dataRoot = join(root, "state-home", "imp");

    await runCli(["init"], env);
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

    await expect(runCli([], env)).rejects.toSatisfy((error: { stderr?: string }) => {
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

    await runCli(["init"], env);
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

    await expect(runCli([], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `Another daemon instance is already running with pid ${process.pid}.`,
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
