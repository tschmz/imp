import { loadSkillFromDirectory } from "../../skills/discovery.js";
import type { SkillDefinition } from "../../skills/types.js";
import type { ToolDefinition } from "../../tools/types.js";
import { renderPromptTemplate, type PromptTemplateContext } from "../prompt-template.js";
import { createUserVisibleToolError, toUserVisibleToolError } from "../user-visible-tool-error.js";

export function createConfiguredSkillTools(
  skills: SkillDefinition[],
  templateContext?: PromptTemplateContext,
): ToolDefinition[] {
  return skills.length > 0 ? [createLoadSkillTool(skills, templateContext)] : [];
}

export function createLoadSkillTool(
  skills: SkillDefinition[],
  templateContext?: PromptTemplateContext,
): ToolDefinition {
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));
  const parameters = {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: skills.map((skill) => skill.name),
        minLength: 1,
        description: "Exact skill name from the available skill catalog.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: "load_skill",
    label: "load_skill",
    description: "Load the full SKILL.md instructions for an available skill and list bundled resources.",
    parameters,
    async execute(_toolCallId, params) {
      const { name } = parseLoadSkillParams(params);
      const skill = skillByName.get(name);
      if (!skill) {
        throw createUserVisibleToolError(
          "tool_command_execution",
          `Unknown skill: ${name}. Available skills: ${skills.map((entry) => entry.name).join(", ")}`,
        );
      }

      const refreshedSkill = await loadSkillFromDirectory(skill.directoryPath).catch((error: unknown) => {
        throw toUserVisibleToolError(error, {
          fallbackMessage: `Could not load skill: ${name}.`,
          defaultKind: "file_document_persistence",
        });
      });
      const loadedSkill = {
        ...refreshedSkill,
        name: skill.name,
        description: skill.description,
      };
      const renderedBody = templateContext
        ? renderPromptTemplate(loadedSkill.body, {
            filePath: loadedSkill.filePath,
            context: templateContext,
          }).trim()
        : loadedSkill.body.trim();
      const text = [
        `<skill_content name="${escapeToolAttribute(loadedSkill.name)}">\n${renderedBody}\n\nSkill directory: ${loadedSkill.directoryPath}\n\n${renderSkillResources(loadedSkill)}\n</skill_content>`,
      ].join("\n\n");

      return {
        content: [{ type: "text", text }],
        details: {
          skillName: loadedSkill.name,
          skillPath: loadedSkill.filePath,
          skillDirectoryPath: loadedSkill.directoryPath,
          references: loadedSkill.references.map((reference) => ({
            path: reference.filePath,
            relativePath: toSkillRelativeResourcePath("references", reference.relativePath),
          })),
          scripts: loadedSkill.scripts.map((script) => ({
            path: script.filePath,
            relativePath: toSkillRelativeResourcePath("scripts", script.relativePath),
          })),
        },
      };
    },
  };
}

function renderSkillResources(skill: SkillDefinition): string {
  const resources = [
    ...skill.scripts.map((resource) => ({
      kind: "script",
      relativePath: toSkillRelativeResourcePath("scripts", resource.relativePath),
      filePath: resource.filePath,
    })),
    ...skill.references.map((resource) => ({
      kind: "reference",
      relativePath: toSkillRelativeResourcePath("references", resource.relativePath),
      filePath: resource.filePath,
    })),
  ].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath) || left.filePath.localeCompare(right.filePath),
  );

  if (resources.length === 0) {
    return "<skill_resources>\n</skill_resources>";
  }

  return [
    "<skill_resources>",
    ...resources.map((resource) =>
      `<file kind="${escapeToolAttribute(resource.kind)}" path="${escapeToolAttribute(resource.filePath)}">${escapeToolText(resource.relativePath)}</file>`,
    ),
    "</skill_resources>",
  ].join("\n");
}

function toSkillRelativeResourcePath(directoryName: "references" | "scripts", relativePath: string): string {
  return `${directoryName}/${relativePath}`;
}

function parseLoadSkillParams(params: unknown): { name: string } {
  if (typeof params !== "object" || params === null) {
    throw createUserVisibleToolError("tool_command_execution", "load_skill requires an object parameter with a name.");
  }

  const name = "name" in params ? params.name : undefined;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw createUserVisibleToolError("tool_command_execution", "load_skill requires a non-empty string name.");
  }

  return { name: name.trim() };
}

function escapeToolAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeToolText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
