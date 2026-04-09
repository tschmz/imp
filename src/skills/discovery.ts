import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, resolve } from "node:path";
import type { SkillCatalog, SkillDefinition, SkillFrontmatter } from "./types.js";

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 500;

export async function discoverSkills(paths: string[]): Promise<SkillCatalog> {
  const issues: string[] = [];
  const discoveredSkills: SkillDefinition[] = [];

  for (const configuredPath of paths) {
    const directoryPath = resolve(configuredPath);
    let entries: Dirent<string>[];

    try {
      entries = await readdir(directoryPath, { withFileTypes: true, encoding: "utf8" }) as Dirent<string>[];
    } catch (error) {
      issues.push(`Ignored configured skill path "${directoryPath}": ${formatErrorDetail(error)}.`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDirectoryPath = join(directoryPath, entry.name);
      const skillFilePath = join(skillDirectoryPath, SKILL_FILE_NAME);
      let content: string;

      try {
        content = await readFile(skillFilePath, "utf8");
      } catch (error) {
        if (isFileNotFoundError(error)) {
          continue;
        }

        issues.push(`Ignored skill file "${skillFilePath}": ${formatErrorDetail(error)}.`);
        continue;
      }

      const parsedSkill = parseSkillFile(content);
      if (!parsedSkill.success) {
        issues.push(`Ignored skill file "${skillFilePath}": ${parsedSkill.error}.`);
        continue;
      }

      const validationError = validateSkillFrontmatter(parsedSkill.frontmatter);
      if (validationError) {
        issues.push(`Ignored skill file "${skillFilePath}": ${validationError}.`);
        continue;
      }

      discoveredSkills.push({
        ...parsedSkill.frontmatter,
        directoryPath: skillDirectoryPath,
        filePath: skillFilePath,
        body: parsedSkill.body,
        content,
      });
    }
  }

  return {
    skills: rejectDuplicateSkills(discoveredSkills, issues),
    issues,
  };
}

function rejectDuplicateSkills(skills: SkillDefinition[], issues: string[]): SkillDefinition[] {
  const skillsByName = new Map<string, SkillDefinition[]>();

  for (const skill of skills) {
    const entries = skillsByName.get(skill.name) ?? [];
    entries.push(skill);
    skillsByName.set(skill.name, entries);
  }

  const uniqueSkills: SkillDefinition[] = [];

  for (const [name, entries] of skillsByName) {
    if (entries.length === 1) {
      uniqueSkills.push(entries[0]!);
      continue;
    }

    issues.push(
      `Ignored duplicate skill name "${name}" from ${entries.map((entry) => `"${entry.filePath}"`).join(", ")}.`,
    );
  }

  return uniqueSkills.sort((left, right) => left.name.localeCompare(right.name));
}

function parseSkillFile(
  content: string,
):
  | {
      success: true;
      frontmatter: SkillFrontmatter;
      body: string;
    }
  | {
      success: false;
      error: string;
    } {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  if (!normalizedContent.startsWith("---\n")) {
    return { success: false, error: "missing YAML frontmatter block" };
  }

  const frontmatterEndIndex = normalizedContent.indexOf("\n---\n", 4);
  if (frontmatterEndIndex === -1) {
    return { success: false, error: "unterminated YAML frontmatter block" };
  }

  const frontmatter = parseSimpleYamlFrontmatter(normalizedContent.slice(4, frontmatterEndIndex));
  if (!frontmatter.success) {
    return frontmatter;
  }

  return {
    success: true,
    frontmatter,
    body: normalizedContent.slice(frontmatterEndIndex + "\n---\n".length),
  };
}

function parseSimpleYamlFrontmatter(
  rawFrontmatter: string,
):
  | (SkillFrontmatter & {
      success: true;
    })
  | {
      success: false;
      error: string;
    } {
  const values = new Map<string, string>();

  for (const line of rawFrontmatter.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf(":");
    if (separatorIndex <= 0) {
      return {
        success: false,
        error: `unsupported frontmatter line "${trimmedLine}"`,
      };
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    if (!rawValue) {
      return {
        success: false,
        error: `frontmatter field "${key}" must define a string value`,
      };
    }

    values.set(key, unquoteFrontmatterValue(rawValue));
  }

  return {
    success: true,
    name: values.get("name") ?? "",
    description: values.get("description") ?? "",
  };
}

function unquoteFrontmatterValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function validateSkillFrontmatter(frontmatter: SkillFrontmatter): string | undefined {
  if (!frontmatter.name.trim()) {
    return 'frontmatter field "name" is required';
  }

  if (frontmatter.name.length > MAX_SKILL_NAME_LENGTH) {
    return `skill name "${frontmatter.name}" is too long; expected at most ${MAX_SKILL_NAME_LENGTH} characters`;
  }

  if (!SKILL_NAME_PATTERN.test(frontmatter.name)) {
    return `skill name "${frontmatter.name}" must contain lowercase letters, digits, or single hyphens only`;
  }

  if (!frontmatter.description.trim()) {
    return 'frontmatter field "description" is required';
  }

  if (frontmatter.description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    return `skill description for "${frontmatter.name}" is too long; expected at most ${MAX_SKILL_DESCRIPTION_LENGTH} characters`;
  }

  return undefined;
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
