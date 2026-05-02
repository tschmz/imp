import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { ConversationContext } from "../domain/conversation.js";
import type { OutgoingMessageAttachment } from "../domain/message.js";
import type { ToolDefinition } from "../tools/types.js";
import { createUserVisibleToolError } from "./user-visible-tool-error.js";

export interface AttachmentCollector {
  add(attachment: OutgoingMessageAttachment): void;
  list(): OutgoingMessageAttachment[];
}

export function createAttachmentCollector(): AttachmentCollector {
  const attachments: OutgoingMessageAttachment[] = [];
  return {
    add(attachment) {
      attachments.push(attachment);
    },
    list() {
      return attachments.slice();
    },
  };
}

export function createAttachFileTool(
  workingDirectory: string,
  collector: AttachmentCollector,
  options: {
    dataRoot?: string;
    conversation?: ConversationContext;
    now?: () => string;
  } = {},
): ToolDefinition {
  const parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        minLength: 1,
        description: "Local path to an existing file to attach to the final response. Do not mention this local path to the user as a downloadable link.",
      },
      fileName: {
        type: "string",
        minLength: 1,
        description: "Optional display filename for the attachment.",
      },
      mimeType: {
        type: "string",
        minLength: 1,
        description: "Optional MIME type for the attachment.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: "attach_file",
    label: "attach_file",
    description: "Attach a local file to the final reply. Queue the file only; do not include local file paths or file:// links in the final text. Telegram sends the queued file as a document after the text response; CLI shows attachments separately.",
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const input = parseAttachFileParams(params);
      const sourcePath = isAbsolute(input.path) ? input.path : join(workingDirectory, input.path);
      const file = await getAttachableFile(sourcePath);
      const fileName = input.fileName ? sanitizeFileName(input.fileName) : sanitizeFileName(basename(sourcePath));
      const exported = await exportAttachableFile({
        sourcePath,
        fileName,
        mimeType: input.mimeType,
        dataRoot: options.dataRoot,
        conversation: options.conversation,
        now: options.now,
      });
      const attachment: OutgoingMessageAttachment = {
        kind: "file",
        path: exported.path,
        fileName: exported.fileName,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      };
      collector.add(attachment);

      return {
        content: [
          {
            type: "text",
            text: [
              `Queued attachment: ${attachment.fileName ?? attachment.path}`,
              "The final response will deliver this file as an attachment.",
              "Do not include local file paths or local file links in the final user-facing text; Telegram users cannot open them.",
            ].join("\n"),
          },
        ],
        details: {
          attachment,
          relativePath: exported.relativePath,
          sourcePath,
          sizeBytes: file.size,
        },
      };
    },
  };
}

interface AttachFileParams {
  path: string;
  fileName?: string;
  mimeType?: string;
}

function parseAttachFileParams(params: unknown): AttachFileParams {
  if (!isRecord(params)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "attach_file requires an object parameter with a path string.",
    );
  }

  if (typeof params.path !== "string" || params.path.trim().length === 0) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "attach_file path must be a non-empty string.",
    );
  }

  const fileName = parseOptionalString(params.fileName, "fileName");
  const mimeType = parseOptionalString(params.mimeType, "mimeType");

  return {
    path: params.path.trim(),
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

async function exportAttachableFile(input: {
  sourcePath: string;
  fileName: string;
  mimeType?: string;
  dataRoot?: string;
  conversation?: ConversationContext;
  now?: () => string;
}): Promise<{
  path: string;
  relativePath?: string;
  fileName: string;
}> {
  if (!input.dataRoot || !input.conversation?.state.conversation.sessionId) {
    return {
      path: input.sourcePath,
      fileName: input.fileName,
    };
  }

  const outputPath = join(
    input.dataRoot,
    "exports",
    sanitizePathSegment(input.conversation.state.agentId),
    sanitizePathSegment(input.conversation.state.conversation.sessionId),
    "attachments",
    `${formatExportTimestamp(input.now?.() ?? new Date().toISOString())}-${input.fileName}`,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(input.sourcePath, outputPath);

  return {
    path: outputPath,
    relativePath: relative(input.dataRoot, outputPath),
    fileName: input.fileName,
  };
}

function parseOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `attach_file ${name} must be a non-empty string when provided.`,
    );
  }
  return value.trim();
}

async function getAttachableFile(path: string): Promise<{ size: number }> {
  let stats;
  try {
    stats = await stat(path);
  } catch (error) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `attach_file could not read file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!stats.isFile()) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "attach_file path must point to a regular file.",
    );
  }

  return { size: stats.size };
}

function sanitizeFileName(value: string): string {
  const cleaned = value.trim().replace(/[/\\]/g, "_").replace(/[^A-Za-z0-9._ -]/g, "_");
  return cleaned.replace(/^\.+/, "").slice(0, 160) || "attachment";
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "unknown";
}

function formatExportTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return sanitizePathSegment(value).slice(0, 32) || "unknown-time";
  }

  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
