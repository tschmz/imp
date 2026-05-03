import { isAbsolute, resolve } from "node:path";
import { createUserVisibleToolError } from "../user-visible-tool-error.js";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface TruncationDetails {
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  maxLines: number;
  maxBytes: number;
}

export function resolveToolPath(workingDirectory: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(workingDirectory, path);
}

export function requireRecord(value: unknown, toolName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `${toolName} requires an object parameter.`,
    );
  }
  return value;
}

export function requireString(value: unknown, name: string, toolName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `${toolName} ${name} must be a non-empty string.`,
    );
  }
  return value;
}

export function optionalString(value: unknown, name: string, toolName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, name, toolName);
}

export function optionalPositiveInteger(
  value: unknown,
  name: string,
  toolName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `${toolName} ${name} must be a non-negative integer when provided.`,
    );
  }
  return value;
}

export function truncateHead(
  content: string,
  options: { maxLines?: number; maxBytes?: number } = {},
): { content: string; details?: TruncationDetails } {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = Buffer.byteLength(content, "utf8");
  const lines = splitLines(content);
  const totalLines = lines.length;

  let output = totalLines > maxLines ? lines.slice(0, maxLines).join("\n") : content;
  let truncatedBy: TruncationDetails["truncatedBy"] = totalLines > maxLines ? "lines" : null;

  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    const nextLines = splitLines(output);
    nextLines.pop();
    output = nextLines.join("\n");
    truncatedBy = "bytes";
  }

  if (!truncatedBy && totalBytes <= maxBytes) {
    return { content };
  }

  const outputBytes = Buffer.byteLength(output, "utf8");
  const outputLines = splitLines(output).length;
  return {
    content: appendTruncationNotice(output, {
      truncated: true,
      truncatedBy,
      totalLines,
      totalBytes,
      outputLines,
      outputBytes,
      maxLines,
      maxBytes,
    }),
    details: {
      truncated: true,
      truncatedBy,
      totalLines,
      totalBytes,
      outputLines,
      outputBytes,
      maxLines,
      maxBytes,
    },
  };
}

export function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

export function textResult(text: string, details: unknown = undefined) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function appendTruncationNotice(content: string, details: TruncationDetails): string {
  return `${content}\n\n[Output truncated: showing ${details.outputLines} of ${details.totalLines} lines, ${formatSize(details.outputBytes)} of ${formatSize(details.totalBytes)}.]`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}
