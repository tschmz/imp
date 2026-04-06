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
  await execFileAsync(process.execPath, ["./node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], {
    cwd: projectRoot,
    env: process.env,
  });
  chmodSync(join(projectRoot, "dist", "main.js"), 0o755);
}, 30_000);

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
    expect(stdout).toContain("backup");
    expect(stdout).toContain("restore");
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

  it("shows help output for config reload", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["config", "reload", "--help"], env);

    expect(stdout).toContain("Usage: imp config reload");
    expect(stdout).toContain("--config <path>");
  });

  it("shows help output for config get", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["config", "get", "--help"], env);

    expect(stdout).toContain("Usage: imp config get");
    expect(stdout).toContain("<keyPath>");
    expect(stdout).toContain("--config <path>");
  });

  it("shows help output for config set", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["config", "set", "--help"], env);

    expect(stdout).toContain("Usage: imp config set");
    expect(stdout).toContain("<keyPath>");
    expect(stdout).toContain("<value>");
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

  it("shows help output for backup", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["backup", "--help"], env);

    expect(stdout).toContain("Usage: imp backup");
    expect(stdout).toContain("create");
  });

  it("shows help output for backup create", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["backup", "create", "--help"], env);

    expect(stdout).toContain("Usage: imp backup create");
    expect(stdout).toContain("--config <path>");
    expect(stdout).toContain("--output <path>");
    expect(stdout).toContain("--only <scopes>");
    expect(stdout).toContain("--force");
  });

  it("shows help output for restore", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    const { stdout } = await runCli(["restore", "--help"], env);

    expect(stdout).toContain("Usage: imp restore");
    expect(stdout).toContain("<inputPath>");
    expect(stdout).toContain("--config <path>");
    expect(stdout).toContain("--data-root <path>");
    expect(stdout).toContain("--only <scopes>");
    expect(stdout).toContain("--force");
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
      agents: Array<{ id: string; prompt: { base: { file?: string } } }>;
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
    expect(config.agents[0]?.prompt.base.file).toBe(promptPath);
    expect(config.bots[0]?.access.allowedUserIds).toEqual([]);
    await expect(readFile(promptPath, "utf8")).resolves.toContain(
      "You are a local coding and operations assistant running through a local Imp daemon.",
    );
  });

  it("creates and restores a backup with config, agent files, and conversations", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const backupPath = join(root, "backup.tar");
    const promptPath = join(dataRoot, "SYSTEM.md");
    const authPath = join(dataRoot, "auth.json");
    const conversationPath = join(dataRoot, "bots", "private-telegram", "conversations", "telegram", "42", "conversation.json");

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
      bots: [
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

    const backupResult = await runCli(["backup", "create", "--output", backupPath], env);

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
      bots: [
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

    const restoreResult = await runCli(["restore", backupPath, "--force"], env);

    expect(restoreResult.stdout).toContain(`Restored backup from ${backupPath}`);
    expect(await readFile(configPath, "utf8")).toContain('"token": "test-token"');
    expect(await readFile(promptPath, "utf8")).toBe("backup prompt\n");
    expect(await readFile(authPath, "utf8")).toBe('{"token":"secret"}\n');
    expect(await readFile(conversationPath, "utf8")).toContain('"hi"');
  });

  it("restores a backup into a bare target config path and data root", async () => {
    const sourceRoot = await createTempDir();
    const sourceEnv = createTestEnv(sourceRoot);
    const sourceConfigPath = join(sourceRoot, "config-home", "imp", "config.json");
    const sourceDataRoot = join(sourceRoot, "state-home", "imp");
    const sourcePromptPath = join(sourceDataRoot, "agents", "SYSTEM.md");
    const sourceInstructionPath = join(sourceDataRoot, "agents", "instructions", "STYLE.md");
    const sourceAuthPath = join(sourceRoot, "config-home", "imp", "auth.json");
    const sourceConversationPath = join(
      sourceDataRoot,
      "bots",
      "private-telegram",
      "conversations",
      "telegram",
      "42",
      "conversation.json",
    );
    const backupPath = join(sourceRoot, "backup.tar");

    await overwriteConfig(sourceConfigPath, {
      instance: { name: "default" },
      paths: { dataRoot: sourceDataRoot },
      logging: { level: "info" },
      defaults: { agentId: "default" },
      agents: [
        {
          id: "default",
          model: { provider: "openai-codex", modelId: "gpt-5.4" },
          authFile: "./auth.json",
          prompt: {
            base: {
              file: sourcePromptPath,
            },
            instructions: [{ file: sourceInstructionPath }],
          },
        },
      ],
      bots: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "test-token",
          access: { allowedUserIds: [] },
        },
      ],
    });
    await writeTextFile(sourcePromptPath, "backup prompt\n");
    await writeTextFile(sourceInstructionPath, "style instruction\n");
    await writeTextFile(sourceAuthPath, '{"token":"secret"}\n');
    await writeTextFile(sourceConversationPath, '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"hi"}]}]}\n');

    await runCli(["backup", "create", "--output", backupPath], sourceEnv);

    const targetRoot = await createTempDir();
    const targetEnv = createTestEnv(targetRoot);
    const targetConfigPath = join(targetRoot, "restore-config", "config.json");
    const targetDataRoot = join(targetRoot, "restore-state");

    const restoreResult = await runCli(
      ["restore", backupPath, "--config", targetConfigPath, "--data-root", targetDataRoot, "--force"],
      targetEnv,
    );

    expect(restoreResult.stdout).toContain(`Config: ${targetConfigPath}`);
    expect(restoreResult.stdout).toContain(`Data root: ${targetDataRoot}`);
    const restoredConfig = JSON.parse(await readFile(targetConfigPath, "utf8")) as {
      paths: { dataRoot: string };
      agents: Array<{
        authFile?: string;
        prompt: {
          base: { file?: string };
          instructions?: Array<{ file?: string }>;
        };
      }>;
    };
    expect(restoredConfig.paths.dataRoot).toBe(targetDataRoot);
    expect(restoredConfig.agents[0]?.authFile).toBe("./auth.json");
    expect(restoredConfig.agents[0]?.prompt.base.file).toBe(join(targetDataRoot, "agents", "SYSTEM.md"));
    expect(restoredConfig.agents[0]?.prompt.instructions?.[0]?.file).toBe(
      join(targetDataRoot, "agents", "instructions", "STYLE.md"),
    );
    expect(await readFile(join(targetDataRoot, "agents", "SYSTEM.md"), "utf8")).toBe("backup prompt\n");
    expect(await readFile(join(targetDataRoot, "agents", "instructions", "STYLE.md"), "utf8")).toBe(
      "style instruction\n",
    );
    expect(await readFile(join(targetRoot, "restore-config", "auth.json"), "utf8")).toBe('{"token":"secret"}\n');
    expect(
      await readFile(
        join(
          targetDataRoot,
          "bots",
          "private-telegram",
          "conversations",
          "telegram",
          "42",
          "conversation.json",
        ),
        "utf8",
      ),
    ).toContain('"hi"');
  });

  it("validates the discovered config through `imp config validate`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await runCli(["init", "--defaults"], env);

    const { stdout } = await runCli(["config", "validate"], env);

    expect(stdout).toBe(`Config valid: ${configPath}\n`);
  });

  it("reads a primitive config value through `imp config get`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    const { stdout } = await runCli(["config", "get", "bots.private-telegram.enabled"], env);

    expect(stdout).toBe("true\n");
  });

  it("reads a structured config value through `imp config get`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    const { stdout } = await runCli(["config", "get", "bots.private-telegram.access"], env);

    expect(stdout).toBe('{\n  "allowedUserIds": []\n}\n');
  });

  it("updates a discovered config value through `imp config set` using array id navigation", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await runCli(["init", "--defaults"], env);

    const { stdout } = await runCli(["config", "set", "bots.private-telegram.enabled", "false"], env);
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      bots: Array<{ id: string; enabled: boolean }>;
    };

    expect(stdout).toBe(`Updated config ${configPath}: bots.private-telegram.enabled\n`);
    expect(config.bots.find((bot) => bot.id === "private-telegram")?.enabled).toBe(false);
  });

  it("updates a discovered config value through `imp config set` using a plain string value", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await runCli(["init", "--defaults"], env);

    const { stdout } = await runCli(["config", "set", "instance.name", "custom-instance"], env);
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      instance: { name: string };
    };

    expect(stdout).toBe(`Updated config ${configPath}: instance.name\n`);
    expect(config.instance.name).toBe("custom-instance");
  });

  it("updates an explicit config path through `imp config set --config` using numeric array navigation", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "custom", "imp.json");

    await overwriteConfig(configPath, {
      instance: {
        name: "custom-instance",
      },
      paths: {
        dataRoot: join(root, "state-home", "imp"),
      },
      logging: {
        level: "warn",
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
      bots: [
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

    const { stdout } = await runCli(["config", "set", "--config", configPath, "bots.0.enabled", "false"], env);
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      bots: Array<{ enabled: boolean }>;
    };

    expect(stdout).toBe(`Updated config ${configPath}: bots.0.enabled\n`);
    expect(config.bots[0]?.enabled).toBe(false);
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
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
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

  it("reads an explicit config path through `imp config get --config`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "custom", "imp.json");

    await overwriteConfig(configPath, {
      instance: {
        name: "custom-instance",
      },
      paths: {
        dataRoot: join(root, "state-home", "imp"),
      },
      logging: {
        level: "warn",
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
      bots: [
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

    const { stdout } = await runCli(["config", "get", "--config", configPath, "logging.level"], env);

    expect(stdout).toBe("warn\n");
  });

  it("fails with the existing missing-config error for `imp config validate`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await expect(runCli(["config", "validate"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("No config file found."),
    });
  });

  it("fails with the existing missing-config error for `imp config get`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await expect(runCli(["config", "get", "instance.name"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("No config file found."),
    });
  });

  it("fails clearly when `imp config set --config` targets a missing file", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "missing", "imp.json");

    await expect(runCli(["config", "set", "--config", configPath, "instance.name", "custom"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Config file not found: ${configPath}`),
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

  it("fails with the existing invalid-config error for `imp config get`", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");

    await overwriteConfig(configPath, {
      invalid: true,
    });

    await expect(runCli(["config", "get", "instance.name"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Invalid config file ${configPath}`),
    });
  });

  it("fails clearly when `imp config set` cannot find the requested key", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    await expect(runCli(["config", "set", "bots.private-telegram.missing", "false"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("Config key not found: bots.private-telegram.missing"),
    });
  });

  it("fails clearly when `imp config set` would make the config invalid", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);
    const configPath = join(root, "config-home", "imp", "config.json");
    const before = await runCli(["init", "--defaults"], env).then(async () => readFile(configPath, "utf8"));

    await expect(runCli(["config", "set", "defaults.agentId", "missing-agent"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining(`Updated config would be invalid: ${configPath}`),
    });

    await expect(readFile(configPath, "utf8")).resolves.toBe(before);
  });

  it("fails clearly when `imp config get` cannot find the requested key", async () => {
    const root = await createTempDir();
    const env = createTestEnv(root);

    await runCli(["init", "--defaults"], env);

    await expect(runCli(["config", "get", "bots.private-telegram.missing"], env)).rejects.toMatchObject({
      stderr: expect.stringContaining("Config key not found: bots.private-telegram.missing"),
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
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
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
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
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
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
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
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
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
          prompt: {
            base: {
              text: "You are a concise and pragmatic assistant running through a local daemon.",
            },
          },
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

async function writeTextFile(path: string, content: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
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
