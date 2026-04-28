import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import { resolveEffectiveSkills } from "./resolve-effective-skills.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("resolveEffectiveSkills", () => {
  it("loads shared and workspace catalogs in compatibility order without the unmanaged app-home catalog", async () => {
    const root = await createTempDir();
    const home = join(root, "home");
    const dataRoot = join(root, "data");
    const workspace = join(root, "workspace");
    vi.stubEnv("HOME", home);

    await writeSkillFile(join(dataRoot, "skills", "shared", "SKILL.md"), createSkillFile("shared", "Data root skill."));
    await writeSkillFile(join(home, ".agents", "skills", "shared", "SKILL.md"), createSkillFile("shared", "User shared skill."));
    await writeSkillFile(join(home, ".openclaw", "skills", "ignored", "SKILL.md"), createSkillFile("ignored", "Ignored skill."));
    await writeSkillFile(join(workspace, ".agents", "skills", "workspace", "SKILL.md"), createSkillFile("workspace", "Workspace agent skill."));
    await writeSkillFile(join(workspace, "skills", "workspace", "SKILL.md"), createSkillFile("workspace", "Workspace project skill."));

    const result = await resolveEffectiveSkills({
      dataRoot,
      agent: createAgent(workspace),
    });

    expect(result.skills.map((skill) => [skill.name, skill.description, skill.filePath])).toEqual([
      ["shared", "User shared skill.", join(home, ".agents", "skills", "shared", "SKILL.md")],
      ["workspace", "Workspace project skill.", join(workspace, "skills", "workspace", "SKILL.md")],
    ]);
    expect(result.overriddenSkillNames).toEqual(["shared", "workspace"]);
    expect(result.skills.map((skill) => skill.name)).not.toContain("ignored");
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-effective-skills-test-"));
  tempDirs.push(path);
  return path;
}

async function writeSkillFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function createSkillFile(name: string, description: string): string {
  return ["---", `name: ${name}`, `description: ${description}`, "---", "", description].join("\n");
}

function createAgent(workspace: string): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    model: {
      provider: "openai",
      modelId: "gpt-4.1",
    },
    prompt: {
      base: {
        text: "You are helpful.",
      },
      instructions: [],
      references: [],
    },
    tools: [],
    extensions: [],
    workspace: {
      cwd: workspace,
    },
  };
}
