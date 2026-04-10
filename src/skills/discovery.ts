import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  SkillCatalog,
  SkillDefinition,
  SkillFrontmatter,
  SkillResourceDefinition,
} from "./types.js";

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

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
        references: await discoverSkillResources(skillDirectoryPath, "references"),
        scripts: await discoverSkillResources(skillDirectoryPath, "scripts"),
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
  const frontmatterMatch = normalizedContent.replace(/^\uFEFF/, "").match(
    /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/,
  );
  if (!frontmatterMatch) {
    return { success: false, error: "missing YAML frontmatter block" };
  }

  const [rawFrontmatterBlock, rawFrontmatter] = frontmatterMatch;
  const frontmatter = parseYamlFrontmatter(rawFrontmatter);
  if (!frontmatter.success) {
    return frontmatter;
  }

  return {
    success: true,
    frontmatter,
    body: normalizedContent.replace(/^\uFEFF/, "").slice(rawFrontmatterBlock.length),
  };
}

function parseYamlFrontmatter(
  rawFrontmatter: string,
):
  | (SkillFrontmatter & {
      success: true;
    })
  | {
      success: false;
      error: string;
    } {
  let parsedFrontmatter: unknown;

  try {
    parsedFrontmatter = parseYaml(rawFrontmatter);
  } catch (error) {
    return {
      success: false,
      error: `invalid YAML frontmatter (${formatErrorDetail(error)})`,
    };
  }

  if (!isPlainRecord(parsedFrontmatter)) {
    return {
      success: false,
      error: "frontmatter must define a YAML mapping",
    };
  }

  const name = parsedFrontmatter.name;
  if (name !== undefined && typeof name !== "string") {
    return {
      success: false,
      error: 'frontmatter field "name" must define a string value',
    };
  }

  const description = parsedFrontmatter.description;
  if (description !== undefined && typeof description !== "string") {
    return {
      success: false,
      error: 'frontmatter field "description" must define a string value',
    };
  }

  return {
    success: true,
    name: name ?? "",
    description: description ?? "",
  };
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

async function discoverSkillResources(
  skillDirectoryPath: string,
  resourceDirectoryName: "references" | "scripts",
): Promise<SkillResourceDefinition[]> {
  const rootPath = join(skillDirectoryPath, resourceDirectoryName);
  const discoveredResources: SkillResourceDefinition[] = [];

  await walkSkillResourceDirectory(rootPath, rootPath, discoveredResources);

  return discoveredResources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkSkillResourceDirectory(
  rootPath: string,
  currentPath: string,
  discoveredResources: SkillResourceDefinition[],
): Promise<void> {
  let entries: Dirent<string>[];

  try {
    entries = await readdir(currentPath, { withFileTypes: true, encoding: "utf8" }) as Dirent<string>[];
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkSkillResourceDirectory(rootPath, entryPath, discoveredResources);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    discoveredResources.push({
      filePath: entryPath,
      relativePath: relative(rootPath, entryPath).replaceAll("\\", "/"),
    });
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
