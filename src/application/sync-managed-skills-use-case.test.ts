import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initAppConfig } from "../config/init-app-config.js";
import { createSyncManagedSkillsUseCase } from "./sync-managed-skills-use-case.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("createSyncManagedSkillsUseCase", () => {
  it("refreshes the installed managed skill from the current package asset", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const env = {
      XDG_STATE_HOME: join(root, "state-home"),
    };
    const writeOutput = vi.fn();

    await initAppConfig({ configPath, env });

    const skillPath = join(dataRoot, "skills", "skill-creator", "SKILL.md");
    await writeFile(skillPath, "stale skill\n", "utf8");

    const syncManagedSkillsUseCase = createSyncManagedSkillsUseCase({
      writeOutput,
    });
    await syncManagedSkillsUseCase({ configPath });

    await expect(readFile(skillPath, "utf8")).resolves.toContain("# Skill Creator");
    expect(writeOutput).toHaveBeenCalledWith(
      `Updated managed skill at ${join(dataRoot, "skills", "plugin-creator", "SKILL.md")}`,
    );
    expect(writeOutput).toHaveBeenCalledWith(`Updated managed skill at ${skillPath}`);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-sync-managed-skills-test-"));
  tempDirs.push(path);
  return path;
}
