import { readFile, stat } from "node:fs/promises";
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

const DEFAULT_MATCH_LIMIT = 100;
const MAX_LINE_LENGTH = 500;

interface GrepToolDetails {
  matchLimitReached?: number;
  linesTruncated?: boolean;
  truncation?: unknown;
}

export function createGrepTool(workingDirectory: string): ToolDefinition {
  return {
    name: "grep",
    label: "grep",
    description: "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB (whichever is hit first). Long lines are truncated to 500 chars.",
    parameters: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Search pattern (regex or literal string)",
        },
        path: {
          type: "string",
          description: "Directory or file to search (default: current directory)",
        },
        glob: {
          type: "string",
          description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
        },
        ignoreCase: {
          type: "boolean",
          description: "Case-insensitive search (default: false)",
        },
        literal: {
          type: "boolean",
          description: "Treat pattern as literal string instead of regex (default: false)",
        },
        context: {
          type: "number",
          description: "Number of lines to show before and after each match (default: 0)",
        },
        limit: {
          type: "number",
          description: "Maximum number of matches to return (default: 100)",
        },
      },
    } as unknown as ToolDefinition["parameters"],
    async execute(_toolCallId, params) {
      const input = parseGrepParams(params);
      const root = resolveToolPath(workingDirectory, input.path ?? ".");
      const rootStats = await stat(root);
      const files = (await collectFiles(root))
        .filter((file) => rootStats.isDirectory() ? matchesGlob(file.relativePath, input.glob) : true);
      const matcher = createMatcher(input.pattern, input.literal, input.ignoreCase);
      const matches: string[] = [];
      let linesTruncated = false;

      for (const file of files) {
        if (matches.length >= input.limit) {
          break;
        }
        const content = await readReadableText(file.absolutePath);
        if (content === undefined) {
          continue;
        }
        collectMatches({
          filePath: rootStats.isDirectory() ? file.relativePath : input.path ?? file.relativePath,
          content,
          matcher,
          context: input.context,
          limit: input.limit,
          matches,
          onLineTruncated: () => {
            linesTruncated = true;
          },
        });
      }

      const body = matches.length > 0 ? matches.join("\n") : "No matches found.";
      const truncated = truncateHead(body, { maxBytes: 50 * 1024, maxLines: Math.max(input.limit, 1) * (input.context * 2 + 1) });
      return textResult(truncated.content, {
        ...(matches.length >= input.limit ? { matchLimitReached: input.limit } : {}),
        ...(linesTruncated ? { linesTruncated } : {}),
        ...(truncated.details ? { truncation: truncated.details } : {}),
      } satisfies GrepToolDetails);
    },
  };
}

function parseGrepParams(params: unknown): {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase: boolean;
  literal: boolean;
  context: number;
  limit: number;
} {
  const record = requireRecord(params, "grep");
  return {
    pattern: requireString(record.pattern, "pattern", "grep"),
    ...(optionalString(record.path, "path", "grep") !== undefined
      ? { path: optionalString(record.path, "path", "grep") }
      : {}),
    ...(optionalString(record.glob, "glob", "grep") !== undefined
      ? { glob: optionalString(record.glob, "glob", "grep") }
      : {}),
    ignoreCase: record.ignoreCase === true,
    literal: record.literal === true,
    context: optionalPositiveInteger(record.context, "context", "grep") ?? 0,
    limit: optionalPositiveInteger(record.limit, "limit", "grep") ?? DEFAULT_MATCH_LIMIT,
  };
}

function createMatcher(pattern: string, literal: boolean, ignoreCase: boolean): (line: string) => boolean {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
  const regex = new RegExp(pattern, ignoreCase ? "i" : undefined);
  return (line) => regex.test(line);
}

async function readReadableText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function collectMatches(input: {
  filePath: string;
  content: string;
  matcher: (line: string) => boolean;
  context: number;
  limit: number;
  matches: string[];
  onLineTruncated: () => void;
}): void {
  const lines = input.content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (input.matches.length >= input.limit) {
      return;
    }
    if (!input.matcher(lines[index] ?? "")) {
      continue;
    }

    const start = Math.max(0, index - input.context);
    const end = Math.min(lines.length - 1, index + input.context);
    for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
      const originalLine = lines[lineIndex] ?? "";
      const rendered = truncateLine(originalLine);
      if (rendered.truncated) {
        input.onLineTruncated();
      }
      input.matches.push(`${input.filePath}:${lineIndex + 1}:${rendered.text}`);
    }
  }
}

function truncateLine(line: string): { text: string; truncated: boolean } {
  if (line.length <= MAX_LINE_LENGTH) {
    return { text: line, truncated: false };
  }
  return { text: `${line.slice(0, MAX_LINE_LENGTH)}[truncated]`, truncated: true };
}
