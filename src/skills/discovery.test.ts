import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSkills, mergeSkillCatalogs } from "./discovery.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("discoverSkills", () => {
  it("discovers valid skills from direct child directories", async () => {
    const root = await createTempDir();
    const skillsRoot = join(root, "skills");
    await writeSkillFile(
      join(skillsRoot, "commit", "SKILL.md"),
      [
        "---",
        "name: commit",
        "description: Stage and commit changes.",
        "---",
        "",
        "Use focused commits.",
      ].join("\n"),
    );

    const result = await discoverSkills([skillsRoot]);

    expect(result.issues).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      name: "commit",
      description: "Stage and commit changes.",
      filePath: join(skillsRoot, "commit", "SKILL.md"),
      body: "\nUse focused commits.",
      references: [],
      scripts: [],
    });
  });

  it("ignores invalid frontmatter", async () => {
    const root = await createTempDir();
    const skillsRoot = join(root, "skills");
    await writeSkillFile(
      join(skillsRoot, "broken", "SKILL.md"),
      [
        "---",
        "name commit",
        "description: Missing separator.",
        "---",
        "",
        "Broken.",
      ].join("\n"),
    );

    const result = await discoverSkills([skillsRoot]);

    expect(result.skills).toEqual([]);
    expect(result.issues.some((issue) => issue.includes("invalid YAML frontmatter"))).toBe(true);
  });

  it("rejects invalid skill names", async () => {
    const root = await createTempDir();
    const skillsRoot = join(root, "skills");
    await writeSkillFile(
      join(skillsRoot, "bad-name", "SKILL.md"),
      [
        "---",
        "name: Bad--Name",
        "description: Invalid name.",
        "---",
        "",
        "Broken.",
      ].join("\n"),
    );

    const result = await discoverSkills([skillsRoot]);

    expect(result.skills).toEqual([]);
    expect(
      result.issues.some((issue) =>
        issue.includes('skill name "Bad--Name" must contain lowercase letters, digits, or single hyphens only'),
      ),
    ).toBe(true);
  });

  it("rejects duplicate skill names across paths", async () => {
    const root = await createTempDir();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const content = [
      "---",
      "name: commit",
      "description: Stage commits.",
      "---",
      "",
      "Use focused commits.",
    ].join("\n");
    await writeSkillFile(join(firstRoot, "commit-a", "SKILL.md"), content);
    await writeSkillFile(join(secondRoot, "commit-b", "SKILL.md"), content);

    const result = await discoverSkills([firstRoot, secondRoot]);

    expect(result.skills).toEqual([]);
    expect(result.issues.some((issue) => issue.includes('Ignored duplicate skill name "commit"'))).toBe(true);
  });

  it("scans only direct child directories", async () => {
    const root = await createTempDir();
    const skillsRoot = join(root, "skills");
    await writeSkillFile(
      join(skillsRoot, "direct", "SKILL.md"),
      [
        "---",
        "name: direct",
        "description: Direct child skill.",
        "---",
        "",
        "Direct body.",
      ].join("\n"),
    );
    await writeSkillFile(
      join(skillsRoot, "nested", "deeper", "SKILL.md"),
      [
        "---",
        "name: nested",
        "description: Nested skill.",
        "---",
        "",
        "Nested body.",
      ].join("\n"),
    );
    await writeSkillFile(
      join(skillsRoot, "SKILL.md"),
      [
        "---",
        "name: root",
        "description: Root skill.",
        "---",
        "",
        "Root body.",
      ].join("\n"),
    );

    const result = await discoverSkills([skillsRoot]);

    expect(result.skills.map((skill) => skill.name)).toEqual(["direct"]);
  });

  it("accepts YAML block scalars and discovers references and scripts", async () => {
    const root = await createTempDir();
    const skillsRoot = join(root, "skills");
    await writeSkillFile(
      join(skillsRoot, "commit", "SKILL.md"),
      [
        "---",
        "name: commit",
        "description: |",
        "  Stage and commit changes.",
        "  Include only focused files.",
        "---",
        "",
        "Use focused commits.",
      ].join("\n"),
    );
    await writeSkillFile(join(skillsRoot, "commit", "references", "checklist.md"), "Checklist");
    await writeSkillFile(join(skillsRoot, "commit", "scripts", "prepare.sh"), "#!/usr/bin/env bash");

    const result = await discoverSkills([skillsRoot]);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      description: "Stage and commit changes.\nInclude only focused files.\n",
      references: [
        {
          filePath: join(skillsRoot, "commit", "references", "checklist.md"),
          relativePath: "checklist.md",
        },
      ],
      scripts: [
        {
          filePath: join(skillsRoot, "commit", "scripts", "prepare.sh"),
          relativePath: "prepare.sh",
        },
      ],
    });
  });

  it("accepts spec-aligned description lengths up to 1024 characters", async () => {
    const root = await createTempDir();
    const skillsRoot = join(root, "skills");
    await writeSkillFile(
      join(skillsRoot, "commit", "SKILL.md"),
      ["---", "name: commit", `description: "${"a".repeat(1024)}"`, "---", "", "Use focused commits."].join("\n"),
    );

    const result = await discoverSkills([skillsRoot]);

    expect(result.issues).toEqual([]);
    expect(result.skills).toHaveLength(1);
  });

  it("can ignore missing skill roots for optional workspace catalogs", async () => {
    const root = await createTempDir();
    const missingSkillsRoot = join(root, ".skills");

    const result = await discoverSkills([missingSkillsRoot], { ignoreMissingPaths: true });

    expect(result).toEqual({
      skills: [],
      issues: [],
    });
  });
});

describe("mergeSkillCatalogs", () => {
  it("lets workspace skills override configured bot skills by name", () => {
    const configuredSkill = createSkillDefinition("commit", "Configured commit flow.", "/configured");
    const workspaceSkill = createSkillDefinition("commit", "Workspace-specific commit flow.", "/workspace");
    const reviewSkill = createSkillDefinition("review", "Review the diff.", "/configured");

    const result = mergeSkillCatalogs([configuredSkill, reviewSkill], [workspaceSkill]);

    expect(result.overriddenSkillNames).toEqual(["commit"]);
    expect(result.skills).toEqual([workspaceSkill, reviewSkill]);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-skills-discovery-test-"));
  tempDirs.push(path);
  return path;
}

async function writeSkillFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function createSkillDefinition(name: string, description: string, rootPath: string) {
  return {
    name,
    description,
    directoryPath: join(rootPath, name),
    filePath: join(rootPath, name, "SKILL.md"),
    body: `\n${description}`,
    content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}`,
    references: [],
    scripts: [],
  };
}
