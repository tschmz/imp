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
  it("resolves config path by CLI, env, then default-path precedence", async () => {
    const root = await createTempDir();
    const cliConfigPath = join(root, "cli-config.json");
    const envConfigPath = join(root, "env-config.json");
    await writeFile(cliConfigPath, "{}\n", "utf8");
    await writeFile(envConfigPath, "{}\n", "utf8");

    const cliResult = await discoverConfigPath({
      cliConfigPath,
      env: {
        IMP_CONFIG_PATH: envConfigPath,
        XDG_CONFIG_HOME: join(root, "xdg-config"),
      },
    });

    expect(cliResult.configPath).toBe(cliConfigPath);
    expect(cliResult.checkedPaths[0]).toBe(cliConfigPath);

    const envResult = await discoverConfigPath({
      env: {
        IMP_CONFIG_PATH: envConfigPath,
        XDG_CONFIG_HOME: join(root, "xdg-config"),
      },
    });

    expect(envResult.configPath).toBe(envConfigPath);
    expect(envResult.checkedPaths[0]).toBe(envConfigPath);
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
