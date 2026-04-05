import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initAppConfig } from "./init-app-config.js";

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
  it("creates a config under the XDG config path with a fail-closed allowlist", async () => {
    const root = await createTempDir();
    const env = {
      XDG_CONFIG_HOME: join(root, "config-home"),
      XDG_STATE_HOME: join(root, "state-home"),
    };

    const configPath = await initAppConfig({ env });
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      paths: { dataRoot: string; authFile?: string };
      defaults: {
        agentId: string;
      };
      agents: Array<{
        id: string;
        model: {
          provider: string;
          modelId: string;
        };
        authFile?: string;
        tools?: string[];
        context?: {
          files?: string[];
        };
        inference?: {
          maxOutputTokens?: number;
          metadata?: Record<string, unknown>;
          request?: Record<string, unknown>;
        };
        systemPrompt: string;
      }>;
      bots: Array<{ access: { allowedUserIds: string[] } }>;
    };

    expect(configPath).toBe(join(root, "config-home", "imp", "config.json"));
    expect(config.paths.dataRoot).toBe(join(root, "state-home", "imp"));
    expect(config.defaults.agentId).toBe("default");
    expect(config.agents[0]?.model).toEqual({
      provider: "openai",
      modelId: "gpt-5.4",
    });
    expect(config.agents[0]?.authFile).toBe(join(root, "state-home", "imp", "auth.json"));
    expect(config.agents[0]?.tools).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ]);
    expect(config.agents[0]?.context).toBeUndefined();
    expect(config.agents[0]?.inference).toEqual({
      metadata: {
        app: "imp",
      },
      request: {
        store: true,
      },
    });
    expect(config.agents[0]?.systemPrompt).toBe(
      "You are a concise and pragmatic assistant running through a local daemon.",
    );
    expect(config.bots[0]?.access.allowedUserIds).toEqual([]);

    const fileMode = (await stat(configPath)).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it("refuses to overwrite an existing config without force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");

    await initAppConfig({ configPath });

    await expect(initAppConfig({ configPath })).rejects.toThrowError(
      `Config file already exists: ${configPath}\nRe-run with --force to overwrite.`,
    );
  });

  it("resets config permissions to owner read/write when overwriting with force", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");

    await initAppConfig({ configPath });
    await chmod(configPath, 0o644);

    await initAppConfig({ configPath, force: true });

    const fileMode = (await stat(configPath)).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-init-test-"));
  tempDirs.push(path);
  return path;
}
