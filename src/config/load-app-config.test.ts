import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoadAppConfigError, loadAppConfig } from "./load-app-config.js";

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

  it("exposes structured issues for schema validation failures", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    await writeRawFile(configPath, `${JSON.stringify({ invalid: true }, null, 2)}\n`);

    const error = await loadAppConfig(configPath).catch((reason) => reason);
    expect(error).toBeInstanceOf(LoadAppConfigError);
    expect(error).toMatchObject({
      configPath,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["instance"],
          message: "Invalid input: expected object, received undefined",
        }),
        expect.objectContaining({
          path: ["agents"],
          message: "Invalid input: expected array, received undefined",
        }),
      ]),
    });
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
