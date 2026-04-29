import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createValidateConfigUseCase } from "./validate-config-use-case.js";

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

describe("createValidateConfigUseCase", () => {
  it("validates discovered and explicit config paths", async () => {
    const root = await createTempDir();
    const discoveredConfigPath = join(root, "config-home", "imp", "config.json");
    const explicitConfigPath = join(root, "custom", "imp.json");
    const writeOutput = vi.fn();
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));
    vi.stubEnv("IMP_CONFIG_PATH", "");

    await writeConfig(discoveredConfigPath);
    await writeConfig(explicitConfigPath);

    await createValidateConfigUseCase({ writeOutput })({});
    await createValidateConfigUseCase({ writeOutput })({ configPath: explicitConfigPath });

    expect(writeOutput).toHaveBeenCalledWith(`Config valid: ${discoveredConfigPath}`);
    expect(writeOutput).toHaveBeenCalledWith(`Config valid: ${explicitConfigPath}`);
  });

  it("runs agent preflight validation when requested", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const promptPath = join(root, "custom", "prompt.md");
    const writeOutput = vi.fn();

    await mkdir(dirname(promptPath), { recursive: true });
    await writeFile(promptPath, "prompt from file", "utf8");
    await writeConfig(configPath, {
      agents: [
        {
          id: "default",
          model: { provider: "openai", modelId: "gpt-5.4" },
          prompt: {
            base: {
              file: "prompt.md",
            },
          },
        },
      ],
    });

    await createValidateConfigUseCase({ writeOutput })({ configPath, preflight: true });

    expect(writeOutput).toHaveBeenCalledWith("Agent preflight valid: 1 agent(s)");
    expect(writeOutput).toHaveBeenCalledWith(`Config valid: ${configPath}`);
  });

  it("fails preflight when an agent prompt file is missing", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");

    await writeConfig(configPath, {
      agents: [
        {
          id: "default",
          model: { provider: "openai", modelId: "gpt-5.4" },
          prompt: {
            base: {
              file: "missing.md",
            },
          },
        },
      ],
    });

    await expect(createValidateConfigUseCase()({ configPath, preflight: true })).rejects.toThrow(
      `Failed to read base prompt for agent "default": ${join(root, "custom", "missing.md")}`,
    );
  });

  it("fails preflight when an agent references an unknown built-in tool", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");

    await writeConfig(configPath, {
      agents: [
        {
          id: "default",
          model: { provider: "openai", modelId: "gpt-5.4" },
          prompt: {
            base: {
              text: "prompt",
            },
          },
          tools: ["definitely_missing_tool"],
        },
      ],
    });

    await expect(createValidateConfigUseCase()({ configPath, preflight: true })).rejects.toThrow(
      'Unknown tools for agent "default": definitely_missing_tool',
    );
  });

  it("accepts env-backed telegram token references when the env var is set", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const writeOutput = vi.fn();

    vi.stubEnv("IMP_TELEGRAM_BOT_TOKEN", "telegram-from-env");
    await writeConfig(configPath, {
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            env: "IMP_TELEGRAM_BOT_TOKEN",
          },
          access: { allowedUserIds: [] },
        },
      ],
    });

    await createValidateConfigUseCase({ writeOutput })({ configPath });

    expect(writeOutput).toHaveBeenCalledWith(`Config valid: ${configPath}`);
  });

  it("fails validation when a referenced telegram token env var is missing", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");

    await writeConfig(configPath, {
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            env: "IMP_TELEGRAM_BOT_TOKEN",
          },
          access: { allowedUserIds: [] },
        },
      ],
    });

    await expect(createValidateConfigUseCase()({ configPath })).rejects.toThrow(
      "endpoints.0.token references environment variable IMP_TELEGRAM_BOT_TOKEN, but it is not set.",
    );
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-validate-config-test-"));
  tempDirs.push(path);
  return path;
}

async function writeConfig(configPath: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        instance: { name: "default" },
        paths: { dataRoot: join(dirname(dirname(configPath)), "state-home", "imp") },
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
        ...overrides,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
