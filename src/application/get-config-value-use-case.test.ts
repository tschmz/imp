import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGetConfigValueUseCase } from "./get-config-value-use-case.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("createGetConfigValueUseCase", () => {
  it("reads a primitive config value from the discovered config", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    const writeOutput = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(configPath);

    await createGetConfigValueUseCase()({
      keyPath: "endpoints.private-telegram.enabled",
    });

    expect(writeOutput).toHaveBeenCalledWith("true");
  });

  it("reads a structured config value from an explicit path", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const writeOutput = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await writeConfig(configPath);

    await createGetConfigValueUseCase()({
      configPath,
      keyPath: "endpoints.private-telegram.access",
    });

    expect(writeOutput).toHaveBeenCalledWith('{\n  "allowedUserIds": []\n}');
  });

  it("fails clearly when the config key is missing", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(configPath);

    await expect(
      createGetConfigValueUseCase()({
        keyPath: "endpoints.private-telegram.missing",
      }),
    ).rejects.toThrow("Config key not found: endpoints.private-telegram.missing");
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-get-config-value-test-"));
  tempDirs.push(path);
  return path;
}

async function writeConfig(configPath: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(createConfig(join(dirname(dirname(configPath)), "state-home", "imp")), null, 2)}\n`,
    "utf8",
  );
}

function createConfig(dataRoot: string) {
  return {
    instance: { name: "default" },
    paths: { dataRoot },
    logging: { level: "info" },
    defaults: { agentId: "default" },
    agents: [
      {
        id: "default",
        model: { provider: "openai", modelId: "gpt-5.4" },
        prompt: {
          base: {
            text: "prompt",
          },
        },
      },
    ],
    endpoints: [
      {
        id: "private-telegram",
        type: "telegram",
        enabled: true,
        token: "token",
        access: { allowedUserIds: [] },
      },
    ],
  };
}
