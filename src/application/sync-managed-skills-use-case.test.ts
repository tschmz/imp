import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("prints the managed skill paths returned by the sync operation", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state-home", "imp");
    const writeOutput = vi.fn();
    const syncManagedSkills = vi.fn(async () => [
      join(dataRoot, "skills", "alpha-skill", "SKILL.md"),
      join(dataRoot, "skills", "beta-skill", "SKILL.md"),
    ]);
    const skillPath = join(dataRoot, "skills", "alpha-skill", "SKILL.md");

    await writeFile(configPath, `${JSON.stringify(createConfig(dataRoot), null, 2)}\n`, "utf8");

    const syncManagedSkillsUseCase = createSyncManagedSkillsUseCase({
      writeOutput,
      syncManagedSkills,
    });
    await syncManagedSkillsUseCase({ configPath });

    expect(syncManagedSkills).toHaveBeenCalledWith({ configPath });
    expect(writeOutput).toHaveBeenCalledWith(
      `Updated managed skill at ${join(dataRoot, "skills", "beta-skill", "SKILL.md")}`,
    );
    expect(writeOutput).toHaveBeenCalledWith(`Updated managed skill at ${skillPath}`);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-sync-managed-skills-test-"));
  tempDirs.push(path);
  return path;
}

function createConfig(dataRoot: string) {
  return {
    instance: {
      name: "default",
    },
    paths: {
      dataRoot,
    },
    defaults: {
      agentId: "default",
    },
    agents: [
      {
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.5",
        },
      },
    ],
    endpoints: [],
  };
}
