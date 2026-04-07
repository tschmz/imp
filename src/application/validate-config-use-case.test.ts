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
  it("validates the discovered config", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config-home", "imp", "config.json");
    const writeOutput = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "config-home"));

    await writeConfig(configPath);

    await createValidateConfigUseCase()({});

    expect(writeOutput).toHaveBeenCalledWith(`Config valid: ${configPath}`);
  });

  it("validates an explicit config path", async () => {
    const root = await createTempDir();
    const configPath = join(root, "custom", "imp.json");
    const writeOutput = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await writeConfig(configPath);

    await createValidateConfigUseCase()({ configPath });

    expect(writeOutput).toHaveBeenCalledWith(`Config valid: ${configPath}`);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-validate-config-test-"));
  tempDirs.push(path);
  return path;
}

async function writeConfig(configPath: string): Promise<void> {
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
        bots: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "token",
            access: { allowedUserIds: [] },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
