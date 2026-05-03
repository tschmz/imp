import { readdir, stat } from "node:fs/promises";
import type { ToolDefinition } from "../../tools/types.js";
import {
  optionalPositiveInteger,
  optionalString,
  requireRecord,
  resolveToolPath,
  textResult,
  truncateHead,
} from "./common.js";

const DEFAULT_ENTRY_LIMIT = 500;

interface LsToolDetails {
  entryLimitReached?: number;
  truncation?: unknown;
}

export function createLsTool(workingDirectory: string): ToolDefinition {
  return {
    name: "ls",
    label: "ls",
    description: "List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory to list (default: current directory)",
        },
        limit: {
          type: "number",
          description: "Maximum number of entries to return (default: 500)",
        },
      },
    } as unknown as ToolDefinition["parameters"],
    async execute(_toolCallId, params) {
      const input = parseLsParams(params);
      const path = resolveToolPath(workingDirectory, input.path ?? ".");
      const pathStats = await stat(path);
      if (!pathStats.isDirectory()) {
        return textResult(input.path ?? ".", {} satisfies LsToolDetails);
      }

      const entries = await readdir(path, { withFileTypes: true });
      const rendered = entries
        .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, input.limit);
      const body = rendered.length > 0 ? rendered.join("\n") : "(empty directory)";
      const truncated = truncateHead(body, { maxLines: input.limit, maxBytes: 50 * 1024 });

      return textResult(truncated.content, {
        ...(entries.length > input.limit ? { entryLimitReached: input.limit } : {}),
        ...(truncated.details ? { truncation: truncated.details } : {}),
      } satisfies LsToolDetails);
    },
  };
}

function parseLsParams(params: unknown): { path?: string; limit: number } {
  const record = params === undefined ? {} : requireRecord(params, "ls");
  const path = optionalString(record.path, "path", "ls");
  return {
    ...(path !== undefined ? { path } : {}),
    limit: optionalPositiveInteger(record.limit, "limit", "ls") ?? DEFAULT_ENTRY_LIMIT,
  };
}
