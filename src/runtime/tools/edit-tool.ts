import { access, readFile, writeFile } from "node:fs/promises";
import type { ToolDefinition } from "../../tools/types.js";
import { isRecord, requireRecord, requireString, requireStringValue, resolveToolPath, textResult } from "./common.js";
import { createUserVisibleToolError } from "../user-visible-tool-error.js";

interface EditOperation {
  oldText: string;
  newText: string;
}

interface EditToolDetails {
  diff: string;
  firstChangedLine?: number;
}

export function createEditTool(workingDirectory: string): ToolDefinition {
  return {
    name: "edit",
    label: "edit",
    description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    parameters: {
      type: "object",
      required: ["path", "edits"],
      properties: {
        path: {
          type: "string",
          description: "Path to the file to edit (relative or absolute)",
        },
        edits: {
          type: "array",
          description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
          items: {
            type: "object",
            required: ["oldText", "newText"],
            properties: {
              oldText: {
                type: "string",
                description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
              },
              newText: {
                type: "string",
                description: "Replacement text for this targeted edit.",
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    } as unknown as ToolDefinition["parameters"],
    async execute(_toolCallId, params) {
      const input = parseEditParams(params);
      const path = resolveToolPath(workingDirectory, input.path);
      await access(path);
      const original = await readFile(path, "utf8");
      const planned = planEdits(original, input.edits);
      const edited = applyPlannedEdits(original, planned);
      await writeFile(path, edited, "utf8");

      const diff = renderSimpleDiff(original, edited, input.path);
      const details: EditToolDetails = {
        diff,
        ...(findFirstChangedLine(original, edited) !== undefined
          ? { firstChangedLine: findFirstChangedLine(original, edited) }
          : {}),
      };
      return textResult(`Edited ${path}.`, details);
    },
  };
}

function parseEditParams(params: unknown): { path: string; edits: EditOperation[] } {
  const record = requireRecord(params, "edit");
  if (!Array.isArray(record.edits) || record.edits.length === 0) {
    throw createUserVisibleToolError("tool_command_execution", "edit edits must be a non-empty array.");
  }

  return {
    path: requireString(record.path, "path", "edit"),
    edits: record.edits.map((edit, index) => {
      if (!isRecord(edit)) {
        throw createUserVisibleToolError("tool_command_execution", `edit edits[${index}] must be an object.`);
      }
      return {
        oldText: requireString(edit.oldText, `edits[${index}].oldText`, "edit"),
        newText: requireStringValue(edit.newText, `edits[${index}].newText`, "edit"),
      };
    }),
  };
}

function planEdits(content: string, edits: EditOperation[]): Array<EditOperation & { start: number; end: number }> {
  const planned = edits.map((edit) => {
    const first = content.indexOf(edit.oldText);
    if (first === -1) {
      throw createUserVisibleToolError("tool_command_execution", "edit oldText did not match the file content.");
    }
    if (content.indexOf(edit.oldText, first + edit.oldText.length) !== -1) {
      throw createUserVisibleToolError("tool_command_execution", "edit oldText matched multiple locations; provide a larger unique replacement.");
    }
    return {
      ...edit,
      start: first,
      end: first + edit.oldText.length,
    };
  }).sort((left, right) => left.start - right.start);

  for (let index = 1; index < planned.length; index += 1) {
    const previous = planned[index - 1];
    const current = planned[index];
    if (previous && current && current.start < previous.end) {
      throw createUserVisibleToolError("tool_command_execution", "edit replacements must not overlap.");
    }
  }

  return planned;
}

function applyPlannedEdits(content: string, edits: Array<EditOperation & { start: number; end: number }>): string {
  let result = "";
  let cursor = 0;
  for (const edit of edits) {
    result += content.slice(cursor, edit.start);
    result += edit.newText;
    cursor = edit.end;
  }
  return result + content.slice(cursor);
}

function findFirstChangedLine(before: string, after: string): number | undefined {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const length = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      return index + 1;
    }
  }
  return undefined;
}

function renderSimpleDiff(before: string, after: string, path: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines = [`--- ${path}`, `+++ ${path}`];
  for (let index = 0; index < max; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      continue;
    }
    if (beforeLine !== undefined) {
      lines.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      lines.push(`+${afterLine}`);
    }
  }
  return lines.join("\n");
}
