import { describe, expect, it } from "vitest";
import { selectRelevantSkills } from "./selection.js";
import type { SkillDefinition } from "./types.js";

describe("selectRelevantSkills", () => {
  it("activates at most three skills", () => {
    const catalog = [
      createSkill("git-commit", "Commit Git changes carefully."),
      createSkill("git-rebase", "Rebase a Git branch safely."),
      createSkill("git-review", "Review Git history and diffs."),
      createSkill("git-cleanup", "Clean up Git branches."),
    ];

    const result = selectRelevantSkills(
      "Help me review git history, clean up the branch, commit the changes, and rebase safely.",
      catalog,
      3,
    );

    expect(result).toHaveLength(3);
  });
});

function createSkill(name: string, description: string): SkillDefinition {
  return {
    name,
    description,
    directoryPath: `/skills/${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    body: `\n${description}`,
    content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}`,
  };
}
