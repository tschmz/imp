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
  it("reads primitive and structured values from discovered and explicit config paths", async () => {
    const root = await createTempDir();
    const discoveredConfigPath = join(root, "config-home", "imp", "config.json");
    const explicitConfigPath = join(root, "custom", "imp.json");
    const writeOutput = vi.fn();
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(discoveredConfigPath);
    await writeConfig(explicitConfigPath);

    await createGetConfigValueUseCase({ writeOutput })({
      keyPath: "endpoints.private-telegram.enabled",
    });
    await createGetConfigValueUseCase({ writeOutput })({
      configPath: explicitConfigPath,
      keyPath: "endpoints.private-telegram.access",
    });

    expect(writeOutput).toHaveBeenCalledWith("true");
    expect(writeOutput).toHaveBeenCalledWith('{\n  "allowedUserIds": []\n}');
  });

  it("reads wildcard-selected config values", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const writeOutput = vi.fn();

    await writeConfig(configPath);

    await createGetConfigValueUseCase({ writeOutput })({
      configPath,
      keyPath: "agents.*.id",
    });

    expect(writeOutput).toHaveBeenCalledWith('[\n  "default",\n  "ops"\n]');
  });

  it("includes plugin-provided agents in wildcard-selected config values", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const dataRoot = join(root, "state-home", "imp");
    const pluginRoot = join(dataRoot, "plugins", "imp-agents");
    const writeOutput = vi.fn();

    await writeConfig(configPath);
    await writePluginManifest(pluginRoot, {
      schemaVersion: 1,
      id: "imp-agents",
      name: "Imp Agent Pack",
      version: "0.1.0",
      runtime: {
        module: "./plugin.mjs",
      },
      agents: [
        {
          id: "cody",
          prompt: {
            base: {
              file: "./prompts/cody.md",
            },
          },
        },
      ],
    });
    await writeFile(join(pluginRoot, "plugin.mjs"), "throw new Error('must not import plugin runtime');\n", "utf8");

    await createGetConfigValueUseCase({ writeOutput })({
      configPath,
      keyPath: "agents.*.id",
    });

    expect(writeOutput).toHaveBeenCalledWith('[\n  "default",\n  "ops",\n  "imp-agents.cody"\n]');
  });

  it("does not load plugin config when reading unrelated config values", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const dataRoot = join(root, "state-home", "imp");
    const writeOutput = vi.fn();

    await writeConfig(configPath);
    await mkdir(join(dataRoot, "plugins", "broken"), { recursive: true });
    await writeFile(join(dataRoot, "plugins", "broken", "imp-plugin.json"), "{", "utf8");

    await createGetConfigValueUseCase({ writeOutput })({
      configPath,
      keyPath: "logging.level",
    });

    expect(writeOutput).toHaveBeenCalledWith("info");
  });

  it("reads an effective default config value when it is not explicitly set", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const writeOutput = vi.fn();

    await writeConfig(configPath);

    await createGetConfigValueUseCase({ writeOutput })({
      configPath,
      keyPath: "agents.default.home",
    });

    expect(writeOutput).toHaveBeenCalledWith(join(root, "state-home", "imp", "agents", "default"));
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

async function writePluginManifest(pluginRoot: string, manifest: unknown): Promise<void> {
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(pluginRoot, "imp-plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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
      {
        id: "ops",
        model: { provider: "openai", modelId: "gpt-5.4-mini" },
        prompt: {
          base: {
            text: "ops prompt",
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
