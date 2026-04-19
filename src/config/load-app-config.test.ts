import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "./load-app-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("loadAppConfig", () => {
  it("accepts config files prefixed with a UTF-8 BOM", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");

    await writeRawFile(
      configPath,
      `\uFEFF${JSON.stringify(
        {
          instance: {
            name: "default",
          },
          paths: {
            dataRoot: "/tmp/imp",
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
                  text: "You are concise.",
                },
              },
            },
          ],
          endpoints: [
            {
              id: "private-telegram",
              type: "telegram",
              enabled: true,
              token: "telegram-token",
              access: {
                allowedUserIds: [],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    await expect(loadAppConfig(configPath)).resolves.toMatchObject({
      instance: {
        name: "default",
      },
    });
  });

  it("resolves relative paths.dataRoot against the config directory", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "config.json");

    await writeAppConfig(configPath, {
      paths: {
        dataRoot: "./state",
      },
    });

    await expect(loadAppConfig(configPath)).resolves.toMatchObject({
      paths: {
        dataRoot: join(root, "config", "state"),
      },
    });
  });

  it("preserves absolute paths.dataRoot values", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state");

    await writeAppConfig(configPath, {
      paths: {
        dataRoot,
      },
    });

    await expect(loadAppConfig(configPath)).resolves.toMatchObject({
      paths: {
        dataRoot,
      },
    });
  });

  it("rejects malformed json with the resolved path", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");

    await writeRawFile(configPath, "{\n");

    await expect(loadAppConfig(configPath)).rejects.toThrow(`Invalid config file ${configPath}\nMalformed JSON:`);
  });

  it("rejects schema-invalid config with the resolved path", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");

    await writeRawFile(
      configPath,
      `${JSON.stringify(
        {
          invalid: true,
        },
        null,
        2,
      )}\n`,
    );

    await expect(loadAppConfig(configPath)).rejects.toThrow(`Invalid config file ${configPath}`);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-load-config-test-"));
  tempDirs.push(path);
  return path;
}

async function writeRawFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function writeAppConfig(
  path: string,
  overrides: {
    paths?: {
      dataRoot: string;
    };
  } = {},
): Promise<void> {
  await writeRawFile(
    path,
    `${JSON.stringify(
      {
        instance: {
          name: "default",
        },
        paths: {
          dataRoot: "/tmp/imp",
          ...overrides.paths,
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
                text: "You are concise.",
              },
            },
          },
        ],
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}
