import type { ToolDefinition } from "../../tools/types.js";
import {
  optionalPositiveInteger,
  optionalString,
  requireRecord,
  requireString,
  resolveToolPath,
  textResult,
  truncateHead,
} from "./common.js";
import { collectFiles, matchesGlob } from "./file-search.js";

const DEFAULT_RESULT_LIMIT = 1000;

interface FindToolDetails {
  resultLimitReached?: number;
  truncation?: unknown;
}

export function createFindTool(workingDirectory: string): ToolDefinition {
  return {
    name: "find",
    label: "find",
    description: "Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first).",
    parameters: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
        },
        path: {
          type: "string",
          description: "Directory to search in (default: current directory)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 1000)",
        },
      },
    } as unknown as ToolDefinition["parameters"],
    async execute(_toolCallId, params) {
      const input = parseFindParams(params);
      const root = resolveToolPath(workingDirectory, input.path ?? ".");
      const files = await collectFiles(root);
      const matches = files
        .map((file) => file.relativePath)
        .filter((path) => matchesGlob(path, input.pattern))
        .slice(0, input.limit);

      const body = matches.length > 0 ? matches.join("\n") : "No files found.";
      const truncated = truncateHead(body, { maxLines: input.limit, maxBytes: 50 * 1024 });
      return textResult(truncated.content, {
        ...(matches.length >= input.limit ? { resultLimitReached: input.limit } : {}),
        ...(truncated.details ? { truncation: truncated.details } : {}),
      } satisfies FindToolDetails);
    },
  };
}

function parseFindParams(params: unknown): { pattern: string; path?: string; limit: number } {
  const record = requireRecord(params, "find");
  const path = optionalString(record.path, "path", "find");
  return {
    pattern: requireString(record.pattern, "pattern", "find"),
    ...(path !== undefined ? { path } : {}),
    limit: optionalPositiveInteger(record.limit, "limit", "find") ?? DEFAULT_RESULT_LIMIT,
  };
}
