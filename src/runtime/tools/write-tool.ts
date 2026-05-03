import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDefinition } from "../../tools/types.js";
import { requireRecord, requireString, resolveToolPath, textResult } from "./common.js";

interface WriteToolDetails {
  path: string;
  bytes: number;
}

export function createWriteTool(workingDirectory: string): ToolDefinition {
  return {
    name: "write",
    label: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: {
          type: "string",
          description: "Path to the file to write (relative or absolute)",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
    } as unknown as ToolDefinition["parameters"],
    async execute(_toolCallId, params) {
      const input = parseWriteParams(params);
      const path = resolveToolPath(workingDirectory, input.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.content, "utf8");

      return textResult(`Wrote ${Buffer.byteLength(input.content, "utf8")} bytes to ${path}.`, {
        path,
        bytes: Buffer.byteLength(input.content, "utf8"),
      } satisfies WriteToolDetails);
    },
  };
}

function parseWriteParams(params: unknown): { path: string; content: string } {
  const record = requireRecord(params, "write");
  return {
    path: requireString(record.path, "path", "write"),
    content: requireString(record.content, "content", "write"),
  };
}
