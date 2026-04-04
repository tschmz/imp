import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverConfigPath } from "./discover-config-path.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("discoverConfigPath", () => {
  it("prefers the explicit cli config path", async () => {
    const root = await createTempDir();
    const cliConfigPath = join(root, "cli-config.json");
    await writeFile(cliConfigPath, "{}\n", "utf8");

    const result = await discoverConfigPath({
      cliConfigPath,
      env: {
        IMP_CONFIG_PATH: join(root, "env-config.json"),
        XDG_CONFIG_HOME: join(root, "xdg-config"),
      },
    });

    expect(result.configPath).toBe(cliConfigPath);
    expect(result.checkedPaths[0]).toBe(cliConfigPath);
  });

  it("uses IMP_CONFIG_PATH before XDG and system paths", async () => {
    const root = await createTempDir();
    const envConfigPath = join(root, "env-config.json");
    await writeFile(envConfigPath, "{}\n", "utf8");

    const result = await discoverConfigPath({
      env: {
        IMP_CONFIG_PATH: envConfigPath,
        XDG_CONFIG_HOME: join(root, "xdg-config"),
      },
    });

    expect(result.configPath).toBe(envConfigPath);
    expect(result.checkedPaths[0]).toBe(envConfigPath);
  });

  it("reports the checked paths when no config exists", async () => {
    const root = await createTempDir();
    const env = {
      XDG_CONFIG_HOME: join(root, "xdg-config"),
    };
    const expectedConfigPath = join(root, "xdg-config", "imp", "config.json");

    await expect(discoverConfigPath({ env })).rejects.toThrowError("No config file found.");
    await expect(discoverConfigPath({ env })).rejects.toThrowError(`- ${expectedConfigPath}`);
    await expect(discoverConfigPath({ env })).rejects.toThrowError("- /etc/imp/config.json");
    await expect(discoverConfigPath({ env })).rejects.toThrowError(
      `Create a config at:\n- ${expectedConfigPath}`,
    );
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-config-test-"));
  tempDirs.push(path);
  await mkdir(path, { recursive: true });
  return path;
}
