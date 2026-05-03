import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    const configPath = await initAppConfig({ env, managedSkillsRoot });
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
    const alphaSkillPath = join(root, "state-home", "imp", "skills", "alpha-skill", "SKILL.md");
    const betaSkillPath = join(root, "state-home", "imp", "skills", "beta-skill", "SKILL.md");

    expect(configPath).toBe(join(root, "config-home", "imp", "config.json"));
    expect(config.paths.dataRoot).toBe(join(root, "state-home", "imp"));
    expect(config.defaults.agentId).toBe("default");
    expect(config.defaults.model).toEqual({
      provider: "openai",
      modelId: "gpt-5.5",
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
      "attach_file",
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
    await expect(readFile(alphaSkillPath, "utf8")).resolves.toContain("{{agent.home}}/.skills/example");
    await expect(readFile(alphaSkillPath, "utf8")).resolves.not.toContain(join(root, "state-home", "imp", "skills"));
    expect((await stat(alphaSkillPath)).mode & 0o777).toBe(0o644);
    await expect(readFile(betaSkillPath, "utf8")).resolves.toContain("# Beta Skill");
    expect((await stat(betaSkillPath)).mode & 0o777).toBe(0o644);
  });

  it("refuses to overwrite an existing config without force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, env, managedSkillsRoot });

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
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, env, managedSkillsRoot });

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
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, env, managedSkillsRoot });
    await chmod(configPath, 0o644);

    await initAppConfig({ configPath, force: true, env, managedSkillsRoot });

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
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, env, managedSkillsRoot });
    const originalContent = await readFile(configPath, "utf8");

    await chmod(configPath, 0o644);
    await initAppConfig({
      configPath,
      force: true,
      env,
      now: new Date("2026-04-05T18:15:00.000Z"),
      managedSkillsRoot,
    });

    await expect(readFile(backupPath, "utf8")).resolves.toBe(originalContent);
    const backupMode = (await stat(backupPath)).mode & 0o777;
    expect(backupMode).toBe(0o600);
  });

  it("creates a backup before overwriting an existing imp skill with force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const skillPath = join(dataRoot, "skills", "alpha-skill", "SKILL.md");
    const backupPath = `${skillPath}.2026-04-05T18-15-00.000Z.bak`;
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, env, managedSkillsRoot });
    const originalContent = await readFile(skillPath, "utf8");

    await initAppConfig({
      configPath,
      force: true,
      env,
      now: new Date("2026-04-05T18:15:00.000Z"),
      managedSkillsRoot,
    });

    await expect(readFile(backupPath, "utf8")).resolves.toBe(originalContent);
    expect((await stat(backupPath)).mode & 0o777).toBe(0o644);
  });

  it("does not write the config when the imp skill already exists without force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const alphaSkillPath = join(dataRoot, "skills", "alpha-skill", "SKILL.md");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, env, managedSkillsRoot });
    await expect(
      initAppConfig({ configPath: join(root, "second-config.json"), env, managedSkillsRoot }),
    ).rejects.toThrowError(
      `Imp skill already exists: ${alphaSkillPath}\nRe-run with --force to overwrite.`,
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
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ env, managedSkillsRoot });

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
      modelId: "gpt-5.5",
      telegramToken: "replace-me",
      allowedUserIds: [],
      promptBaseFile: promptPath,
    });

    await expect(readFile(promptPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, config, managedSkillsRoot });
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
      modelId: "gpt-5.5",
      telegramToken: "123:abc",
      allowedUserIds: ["1", "2"],
      workingDirectory: join(root, "workspace"),
      instructionFiles: [join(root, "workspace", "AGENTS.md")],
      promptBaseFile: join(root, "SYSTEM.md"),
    });
    const managedSkillsRoot = await createManagedSkillsFixture(root);

    await initAppConfig({ configPath, config, managedSkillsRoot });

    const rawConfig = await readFile(configPath, "utf8");
    expect(rawConfig).toContain('"authFile"');
    expect(rawConfig).toContain('"model"');
    await expect(readFile(configPath, "utf8")).resolves.toContain('"prompt"');
    await expect(
      readFile(join(root, "custom-state", "skills", "alpha-skill", "SKILL.md"), "utf8"),
    ).resolves.toContain("{{agent.home}}/.skills/example");
    await expect(
      readFile(join(root, "custom-state", "skills", "alpha-skill", "SKILL.md"), "utf8"),
    ).resolves.not.toContain(join(root, "workspace", ".agents", "skills"));
    await expect(
      readFile(join(root, "custom-state", "skills", "beta-skill", "SKILL.md"), "utf8"),
    ).resolves.toContain("# Beta Skill");
  });

  it("syncs the managed imp skill from the installed asset", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const managedSkillsRoot = await createManagedSkillsFixture(root);
    const skillPath = join(root, "state-home", "imp", "skills", "alpha-skill", "SKILL.md");
    const betaSkillPath = join(root, "state-home", "imp", "skills", "beta-skill", "SKILL.md");

    await initAppConfig({ configPath, env, managedSkillsRoot });
    await chmod(skillPath, 0o600);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(skillPath, "stale skill\n", "utf8"));

    await expect(syncManagedSkills({ configPath, managedSkillsRoot })).resolves.toEqual([skillPath, betaSkillPath]);
    await expect(readFile(skillPath, "utf8")).resolves.toContain("# Alpha Skill");
    expect((await stat(skillPath)).mode & 0o777).toBe(0o644);
  });

  it("creates a backup before syncing an existing managed imp skill", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const managedSkillsRoot = await createManagedSkillsFixture(root);
    const skillPath = join(root, "state-home", "imp", "skills", "alpha-skill", "SKILL.md");
    const backupPath = `${skillPath}.2026-04-05T18-15-00.000Z.bak`;

    await initAppConfig({ configPath, env, managedSkillsRoot });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(skillPath, "stale skill\n", "utf8"));

    await syncManagedSkills({
      configPath,
      now: new Date("2026-04-05T18:15:00.000Z"),
      managedSkillsRoot,
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

async function createManagedSkillsFixture(root: string): Promise<string> {
  const managedSkillsRoot = join(root, "managed-skills-assets");
  await writeSkillFixture(
    managedSkillsRoot,
    "alpha-skill",
    [
      "---",
      "name: alpha-skill",
      "description: Alpha fixture skill.",
      "---",
      "",
      "# Alpha Skill",
      "",
      "Use {{agent.home}}/.skills/example.",
      "",
    ].join("\n"),
  );
  await writeSkillFixture(
    managedSkillsRoot,
    "beta-skill",
    [
      "---",
      "name: beta-skill",
      "description: Beta fixture skill.",
      "---",
      "",
      "# Beta Skill",
      "",
    ].join("\n"),
  );
  await mkdir(join(managedSkillsRoot, "not-a-skill"), { recursive: true });
  await writeFile(join(managedSkillsRoot, "not-a-skill", "README.md"), "ignored\n", "utf8");
  return managedSkillsRoot;
}

async function writeSkillFixture(root: string, name: string, content: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), content, "utf8");
}
