import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSetConfigValueUseCase } from "./set-config-value-use-case.js";

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

describe("createSetConfigValueUseCase", () => {
  it("updates a discovered config value using array id navigation", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    const writeOutput = vi.fn();
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(configPath);

    await createSetConfigValueUseCase({ writeOutput })({
      keyPath: "endpoints.private-telegram.enabled",
      value: "false",
    });

    const config = JSON.parse(await readFile(configPath, "utf8")) as { endpoints: Array<{ enabled: boolean }> };
    expect(writeOutput).toHaveBeenCalledWith(`Updated config ${configPath}: endpoints.private-telegram.enabled`);
    expect(config.endpoints[0]?.enabled).toBe(false);
  });

  it("updates a plain string value", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(configPath);

    await createSetConfigValueUseCase({ writeOutput: vi.fn() })({
      keyPath: "instance.name",
      value: "custom-instance",
    });

    const config = JSON.parse(await readFile(configPath, "utf8")) as { instance: { name: string } };
    expect(config.instance.name).toBe("custom-instance");
  });

  it("updates an explicit config path using numeric array navigation", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");

    await writeConfig(configPath);

    await createSetConfigValueUseCase({ writeOutput: vi.fn() })({
      configPath,
      keyPath: "endpoints.0.enabled",
      value: "false",
    });

    const config = JSON.parse(await readFile(configPath, "utf8")) as { endpoints: Array<{ enabled: boolean }> };
    expect(config.endpoints[0]?.enabled).toBe(false);
  });

  it("updates a BOM-prefixed config file", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");

    await writeRawFile(
      configPath,
      `\uFEFF${JSON.stringify(createConfig(join(root, "state-home", "imp")), null, 2)}\n`,
    );

    await createSetConfigValueUseCase({ writeOutput: vi.fn() })({
      configPath,
      keyPath: "instance.name",
      value: "custom-instance",
    });

    const config = JSON.parse(await readFile(configPath, "utf8")) as { instance: { name: string } };
    expect(config.instance.name).toBe("custom-instance");
  });

  it("fails when an explicit config path is missing", async () => {
    const root = await createTempDir();
    const configPath = join(root, "missing", "imp.json");

    await expect(
      createSetConfigValueUseCase()({
        configPath,
        keyPath: "instance.name",
        value: "custom",
      }),
    ).rejects.toThrow(`Config file not found: ${configPath}`);
  });

  it("fails with an input-file error when the config JSON is malformed", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeRawFile(configPath, "{\n  \"invalid\": true\n");

    await expect(
      createSetConfigValueUseCase()({
        keyPath: "instance.name",
        value: "custom",
      }),
    ).rejects.toThrow(`Invalid input config file ${configPath}`);
  });

  it("fails with a key-path error when the requested config key is missing", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(configPath);

    await expect(
      createSetConfigValueUseCase()({
        keyPath: "endpoints.private-telegram.missing",
        value: "false",
      }),
    ).rejects.toThrow("Invalid target key path: endpoints.private-telegram.missing");
  });


  it("allows updating a slightly inconsistent config when the mutation restores schema validity", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    const config = createConfig(join(root, "state-home", "imp"));
    config.defaults.agentId = "missing-agent";
    await writeRawFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    await createSetConfigValueUseCase({ writeOutput: vi.fn() })({
      keyPath: "defaults.agentId",
      value: "default",
    });

    const updated = JSON.parse(await readFile(configPath, "utf8")) as { defaults: { agentId: string } };
    expect(updated.defaults.agentId).toBe("default");
  });

  it("shows a clear schema-violation error when the new target value is invalid", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(configPath);

    await expect(
      createSetConfigValueUseCase()({
        keyPath: "agents.0.prompt.base",
        value: "{}",
      }),
    ).rejects.toThrow(
      `Config update violates schema: ${configPath}\nagents[0].prompt.base: Specify exactly one of text or file.`,
    );
  });
  it("fails when the updated config would become invalid without modifying the file", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(configPath);
    const before = await readFile(configPath, "utf8");

    await expect(
      createSetConfigValueUseCase()({
        keyPath: "defaults.agentId",
        value: "missing-agent",
      }),
    ).rejects.toThrow(`Config update violates schema: ${configPath}`);

    await expect(readFile(configPath, "utf8")).resolves.toBe(before);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-set-config-value-test-"));
  tempDirs.push(path);
  return path;
}

async function writeConfig(configPath: string): Promise<void> {
  await writeRawFile(
    configPath,
    `${JSON.stringify(createConfig(join(dirname(dirname(configPath)), "state-home", "imp")), null, 2)}\n`,
  );
}

async function writeRawFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
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
