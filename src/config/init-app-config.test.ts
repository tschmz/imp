import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInitialAppConfig } from "./default-app-config.js";
import { assertInitConfigCanBeCreated, initAppConfig } from "./init-app-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("initAppConfig", () => {
  it("creates a config under the XDG config path without daemon endpoints", async () => {
    const root = await createTempDir();
    const env = {
      XDG_CONFIG_HOME: join(root, "config-home"),
      XDG_STATE_HOME: join(root, "state-home"),
    };

    const configPath = await initAppConfig({ env });
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      paths: { dataRoot: string };
      defaults: {
        agentId: string;
      };
      agents: Array<{
        id: string;
        model: {
          provider: string;
          modelId: string;
        };
        tools?: string[];
        workspace?: {
          cwd?: string;
        };
        prompt?: {
          base?: { file?: string; text?: string };
        };
        inference?: {
          maxOutputTokens?: number;
          metadata?: Record<string, unknown>;
          request?: Record<string, unknown>;
        };
      }>;
      endpoints: unknown[];
    };

    expect(configPath).toBe(join(root, "config-home", "imp", "config.json"));
    expect(config.paths.dataRoot).toBe(join(root, "state-home", "imp"));
    expect(config.defaults.agentId).toBe("default");
    expect(config.agents[0]?.model).toEqual({
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(config.agents[0]?.tools).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ]);
    expect(config.agents[0]?.workspace).toBeUndefined();
    expect(config.agents[0]?.inference).toEqual({
      metadata: {
        app: "imp",
      },
      request: {
        store: true,
      },
    });
    expect(config.agents[0]?.prompt).toBeUndefined();
    expect(config.endpoints).toEqual([]);

    const fileMode = (await stat(configPath)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    await expect(readFile(join(root, "state-home", "imp", "SYSTEM.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to overwrite an existing config without force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };

    await initAppConfig({ configPath, env });

    await expect(assertInitConfigCanBeCreated({ configPath })).rejects.toThrowError(
      `Config file already exists: ${configPath}\nRe-run with --force to overwrite.`,
    );
  });

  it("allows overwriting an existing config when force is set", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };

    await initAppConfig({ configPath, env });

    await expect(assertInitConfigCanBeCreated({ configPath, force: true })).resolves.toBe(
      configPath,
    );
  });

  it("resets config permissions to owner read/write when overwriting with force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };

    await initAppConfig({ configPath, env });
    await chmod(configPath, 0o644);

    await initAppConfig({ configPath, force: true, env });

    const fileMode = (await stat(configPath)).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it("creates a backup before overwriting an existing config with force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const backupPath = `${configPath}.2026-04-05T18-15-00.000Z.bak`;
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };

    await initAppConfig({ configPath, env });
    const originalContent = await readFile(configPath, "utf8");

    await chmod(configPath, 0o644);
    await initAppConfig({
      configPath,
      force: true,
      env,
      now: new Date("2026-04-05T18:15:00.000Z"),
    });

    await expect(readFile(backupPath, "utf8")).resolves.toBe(originalContent);
    const backupMode = (await stat(backupPath)).mode & 0o777;
    expect(backupMode).toBe(0o600);
  });

  it("does not write the default agent system prompt file", async () => {
    const root = await createTempDir();
    const env = {
      XDG_CONFIG_HOME: join(root, "config-home"),
      XDG_STATE_HOME: join(root, "state-home"),
    };

    await initAppConfig({ env });

    const promptPath = join(root, "state-home", "imp", "SYSTEM.md");
    await expect(readFile(promptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not manage a configured base prompt file", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const promptPath = join(root, "SYSTEM.md");
    const config = buildInitialAppConfig(process.env, {
      instanceName: "default",
      dataRoot: root,
      provider: "openai",
      modelId: "gpt-5.4",
      telegramToken: "replace-me",
      allowedUserIds: [],
      promptBaseFile: promptPath,
    });

    await expect(readFile(promptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await initAppConfig({ configPath, config });
    await expect(readFile(promptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("writes a provided config template", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_CONFIG_HOME: join(root, "config-home"),
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const config = buildInitialAppConfig(env, {
      instanceName: "home",
      dataRoot: join(root, "custom-state"),
      provider: "openai-codex",
      modelId: "gpt-5.4",
      telegramToken: "123:abc",
      allowedUserIds: ["1", "2"],
      workingDirectory: join(root, "workspace"),
      instructionFiles: [join(root, "workspace", "AGENTS.md")],
      promptBaseFile: join(root, "SYSTEM.md"),
    });

    await initAppConfig({ configPath, config });

    await expect(readFile(configPath, "utf8")).resolves.toContain('"authFile"');
    await expect(readFile(configPath, "utf8")).resolves.toContain('"prompt"');
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-init-test-"));
  tempDirs.push(path);
  return path;
}
