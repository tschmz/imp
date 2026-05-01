import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInitialAppConfig } from "./default-app-config.js";
import { assertInitConfigCanBeCreated, initAppConfig, syncManagedSkills } from "./init-app-config.js";

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
        model?: {
          provider: string;
          modelId: string;
          authFile?: string;
          inference?: {
            maxOutputTokens?: number;
            metadata?: Record<string, unknown>;
            request?: Record<string, unknown>;
          };
        };
      };
      agents: Array<{
        id: string;
        model?: {
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
      }>;
      endpoints: unknown[];
    };
    const skillPath = join(root, "state-home", "imp", "skills", "imp-skill-creator", "SKILL.md");

    expect(configPath).toBe(join(root, "config-home", "imp", "config.json"));
    expect(config.paths.dataRoot).toBe(join(root, "state-home", "imp"));
    expect(config.defaults.agentId).toBe("default");
    expect(config.defaults.model).toEqual({
      provider: "openai",
      modelId: "gpt-5.4",
      inference: {
        metadata: {
          app: "imp",
        },
        request: {
          store: true,
        },
      },
    });
    expect(config.agents[0]?.model).toBeUndefined();
    expect(config.agents[0]?.tools).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "update_plan",
    ]);
    expect(config.agents[0]?.workspace).toBeUndefined();
    expect(config.agents[0]).not.toHaveProperty("inference");
    expect(config.agents[0]?.prompt).toBeUndefined();
    expect(config.endpoints).toEqual([]);

    const fileMode = (await stat(configPath)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    await expect(readFile(join(root, "state-home", "imp", "SYSTEM.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(skillPath, "utf8")).resolves.toContain(
      `- global shared catalog: \`${join(root, "state-home", "imp", "skills")}\``,
    );
    await expect(readFile(skillPath, "utf8")).resolves.not.toContain("/home/thomas/.imp");
    expect((await stat(skillPath)).mode & 0o777).toBe(0o644);
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

  it("creates a backup before overwriting an existing imp skill with force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const skillPath = join(dataRoot, "skills", "imp-skill-creator", "SKILL.md");
    const backupPath = `${skillPath}.2026-04-05T18-15-00.000Z.bak`;
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };

    await initAppConfig({ configPath, env });
    const originalContent = await readFile(skillPath, "utf8");

    await initAppConfig({
      configPath,
      force: true,
      env,
      now: new Date("2026-04-05T18:15:00.000Z"),
    });

    await expect(readFile(backupPath, "utf8")).resolves.toBe(originalContent);
    expect((await stat(backupPath)).mode & 0o777).toBe(0o644);
  });

  it("does not write the config when the imp skill already exists without force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const skillPath = join(dataRoot, "skills", "imp-skill-creator", "SKILL.md");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };

    await initAppConfig({ configPath, env });
    await expect(initAppConfig({ configPath: join(root, "second-config.json"), env })).rejects.toThrowError(
      `Imp skill already exists: ${skillPath}\nRe-run with --force to overwrite.`,
    );
    await expect(readFile(join(root, "second-config.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
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

    const rawConfig = await readFile(configPath, "utf8");
    expect(rawConfig).toContain('"authFile"');
    expect(rawConfig).toContain('"model"');
    await expect(readFile(configPath, "utf8")).resolves.toContain('"prompt"');
    await expect(
      readFile(join(root, "custom-state", "skills", "imp-skill-creator", "SKILL.md"), "utf8"),
    ).resolves.toContain(`- global shared catalog: \`${join(root, "custom-state", "skills")}\``);
    await expect(
      readFile(join(root, "custom-state", "skills", "imp-skill-creator", "SKILL.md"), "utf8"),
    ).resolves.toContain(`- workspace agent catalog for default: \`${join(root, "workspace", ".agents", "skills")}\``);
  });

  it("syncs the managed imp skill from the installed asset", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const skillPath = join(root, "state-home", "imp", "skills", "imp-skill-creator", "SKILL.md");

    await initAppConfig({ configPath, env });
    await chmod(skillPath, 0o600);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(skillPath, "stale skill\n", "utf8"));

    await expect(syncManagedSkills({ configPath })).resolves.toEqual([skillPath]);
    await expect(readFile(skillPath, "utf8")).resolves.toContain("# Imp Skill Creator");
    expect((await stat(skillPath)).mode & 0o777).toBe(0o644);
  });

  it("creates a backup before syncing an existing managed imp skill", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const skillPath = join(root, "state-home", "imp", "skills", "imp-skill-creator", "SKILL.md");
    const backupPath = `${skillPath}.2026-04-05T18-15-00.000Z.bak`;

    await initAppConfig({ configPath, env });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(skillPath, "stale skill\n", "utf8"));

    await syncManagedSkills({
      configPath,
      now: new Date("2026-04-05T18:15:00.000Z"),
    });

    await expect(readFile(backupPath, "utf8")).resolves.toBe("stale skill\n");
    expect((await stat(backupPath)).mode & 0o777).toBe(0o644);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-init-test-"));
  tempDirs.push(path);
  return path;
}
