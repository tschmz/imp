import { access, readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ToolDefinition } from "../../tools/types.js";
import {
  optionalPositiveInteger,
  requireRecord,
  requireString,
  resolveToolPath,
  splitLines,
  truncateHead,
} from "./common.js";

interface ReadToolDetails {
  path: string;
  truncation?: unknown;
}

const imageMimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

export function createReadTool(workingDirectory: string): ToolDefinition {
  return {
    name: "read",
    label: "read",
    description: "Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read (relative or absolute)",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read",
        },
      },
    } as unknown as ToolDefinition["parameters"],
    async execute(_toolCallId, params) {
      const input = parseReadParams(params);
      const path = resolveToolPath(workingDirectory, input.path);
      await access(path);

      const mimeType = detectImageMimeType(path);
      const buffer = await readFile(path);
      if (mimeType) {
        return {
          content: [{ type: "image", data: buffer.toString("base64"), mimeType }],
          details: { path } satisfies ReadToolDetails,
        };
      }

      const text = buffer.toString("utf8");
      const selected = selectLines(text, input.offset, input.limit);
      const truncated = truncateHead(selected);
      return {
        content: [{ type: "text", text: truncated.content }],
        details: {
          path,
          ...(truncated.details ? { truncation: truncated.details } : {}),
        } satisfies ReadToolDetails,
      };
    },
  };
}

function parseReadParams(params: unknown): { path: string; offset?: number; limit?: number } {
  const record = requireRecord(params, "read");
  const path = requireString(record.path, "path", "read");
  const offset = optionalPositiveInteger(record.offset, "offset", "read");
  const limit = optionalPositiveInteger(record.limit, "limit", "read");
  return {
    path,
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function selectLines(content: string, offset: number | undefined, limit: number | undefined): string {
  if (offset === undefined && limit === undefined) {
    return content;
  }

  const lines = splitLines(content);
  const start = offset === undefined ? 0 : Math.max(0, offset - 1);
  const end = limit === undefined ? undefined : start + limit;
  return lines.slice(start, end).join("\n");
}

function detectImageMimeType(path: string): string | undefined {
  return imageMimeTypes.get(extname(path).toLowerCase());
}
