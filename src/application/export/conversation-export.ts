import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import writeFileAtomic from "write-file-atomic";
import type {
  ConversationAssistantMessage,
  ConversationContext,
  ConversationEvent,
  ConversationToolResultMessage,
  ConversationUserMessage,
} from "../../domain/conversation.js";

export type ConversationExportMode = "readable" | "full";
export type ConversationExportFormat = "html";

export interface ConversationExportOptions {
  conversation: ConversationContext;
  dataRoot: string;
  mode: ConversationExportMode;
  format?: ConversationExportFormat;
  now?: string;
}

export interface ConversationExportResult {
  mode: ConversationExportMode;
  format: ConversationExportFormat;
  path: string;
  relativePath: string;
  fileUrl: string;
}

export interface ParsedConversationExportOptions {
  mode: ConversationExportMode;
  format: ConversationExportFormat;
}

export function parseConversationExportOptions(
  commandArgs?: string,
): ParsedConversationExportOptions | undefined {
  const tokens = commandArgs
    ?.trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase()) ?? [];

  let mode: ConversationExportMode = "readable";
  let format: ConversationExportFormat = "html";

  for (const token of tokens) {
    if (token === "readable" || token === "full") {
      mode = token;
      continue;
    }

    if (token === "html") {
      format = token;
      continue;
    }

    return undefined;
  }

  return { mode, format };
}

export async function createConversationExport(
  options: ConversationExportOptions,
): Promise<ConversationExportResult> {
  const format = options.format ?? "html";
  const exportRoot = join(
    options.dataRoot,
    "exports",
    sanitizePathSegment(options.conversation.state.agentId),
    sanitizePathSegment(options.conversation.state.conversation.sessionId ?? "active"),
  );
  const fileName = `conversation-${options.mode}-${formatExportTimestamp(options.now ?? new Date().toISOString())}.${format}`;
  const outputPath = join(exportRoot, fileName);
  const html = renderConversationExportHtml(options.conversation, {
    mode: options.mode,
    createdAt: options.now ?? new Date().toISOString(),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFileAtomic(outputPath, html, { encoding: "utf8" });

  return {
    mode: options.mode,
    format,
    path: outputPath,
    relativePath: relative(options.dataRoot, outputPath),
    fileUrl: pathToFileURL(outputPath).href,
  };
}

export function renderConversationExportHtml(
  conversation: ConversationContext,
  options: { mode: ConversationExportMode; createdAt: string },
): string {
  const title = conversation.state.title ?? "untitled";
  const body = [
    renderHeader(conversation, title, options),
    conversation.messages.length === 0
      ? '<section class="empty">No messages.</section>'
      : `<main class="messages">\n${conversation.messages.map((message) => renderMessage(message, options.mode)).join("\n")}\n</main>`,
  ].join("\n");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)} - Conversation export</title>`,
    `<style>${renderCss()}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function renderHeader(
  conversation: ConversationContext,
  title: string,
  options: { mode: ConversationExportMode; createdAt: string },
): string {
  const rows = [
    ["Title", title],
    ["Agent", conversation.state.agentId],
    ["Session", conversation.state.conversation.sessionId ?? "active"],
    ["Mode", options.mode],
    ["Created", conversation.state.createdAt],
    ["Updated", conversation.state.updatedAt],
    ["Exported", options.createdAt],
    ...(conversation.state.workingDirectory ? [["Working directory", conversation.state.workingDirectory]] : []),
  ];

  return [
    "<header>",
    "<h1>Conversation export</h1>",
    '<dl class="metadata">',
    ...rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`),
    "</dl>",
    "</header>",
  ].join("\n");
}

function renderMessage(message: ConversationEvent, mode: ConversationExportMode): string {
  if (message.role === "user") {
    return renderUserMessage(message);
  }

  if (message.role === "assistant") {
    return renderAssistantMessage(message, mode);
  }

  return renderToolResultMessage(message, mode);
}

function renderUserMessage(message: ConversationUserMessage): string {
  return renderMessageFrame(
    "user",
    "User",
    message.createdAt,
    renderUserContent(message.content),
  );
}

function renderAssistantMessage(
  message: ConversationAssistantMessage,
  mode: ConversationExportMode,
): string {
  const parts = [];

  if (mode === "full") {
    parts.push(renderMetadataList(getAssistantMetadataRows(message)));
  }

  for (const block of message.content) {
    if (block.type === "text") {
      parts.push(renderTextBlock(block.text));
      continue;
    }

    if (block.type === "thinking") {
      if (mode === "full") {
        parts.push('<p class="muted">Internal thinking: present, content omitted.</p>');
      }
      continue;
    }

    parts.push(renderToolCall(block.name, block.id, block.arguments, mode));
  }

  return renderMessageFrame("assistant", "Assistant", message.createdAt, parts.join("\n"));
}

function getAssistantMetadataRows(message: ConversationAssistantMessage): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Model", `${message.provider}/${message.model}`],
    ["Stop reason", message.stopReason],
  ];

  if (message.responseId) {
    rows.push(["Response ID", message.responseId]);
  }

  if ("usage" in message && message.usage) {
    rows.push(["Usage", JSON.stringify(message.usage)]);
  }

  return rows;
}

function renderToolResultMessage(
  message: ConversationToolResultMessage,
  mode: ConversationExportMode,
): string {
  const summary = `Tool result: ${message.toolName} (${message.isError ? "error" : "ok"})`;
  const content = mode === "full"
    ? [
        renderMetadataList([
          ["Tool call ID", message.toolCallId],
          ["Status", message.isError ? "error" : "ok"],
        ]),
        renderImageAndTextContent(message.content),
        ...(message.details !== undefined
          ? [`<h4>Details</h4><pre>${escapeHtml(JSON.stringify(message.details, null, 2))}</pre>`]
          : []),
      ].join("\n")
    : [
        `<p class="muted">Tool call ID: ${escapeHtml(message.toolCallId)}</p>`,
        renderTruncatedContent(renderPlainImageAndTextContent(message.content), 4000),
        message.details !== undefined
          ? '<p class="muted">Technical details are available in full export mode.</p>'
          : "",
      ].filter(Boolean).join("\n");

  return renderMessageFrame(
    "tool-result",
    summary,
    message.createdAt,
    `<details><summary>${escapeHtml(summary)}</summary>${content}</details>`,
  );
}

function renderToolCall(
  name: string,
  id: string,
  args: unknown,
  mode: ConversationExportMode,
): string {
  const summary = `Tool call: ${name}`;
  const content = mode === "full"
    ? [
        renderMetadataList([["ID", id]]),
        `<h4>Arguments</h4><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre>`,
      ].join("\n")
    : [
        `<p class="muted">ID: ${escapeHtml(id)}</p>`,
        `<p>${escapeHtml(summarizeToolArguments(args))}</p>`,
        '<p class="muted">Full arguments are available in full export mode.</p>',
      ].join("\n");

  return `<details class="tool-call"><summary>${escapeHtml(summary)}</summary>${content}</details>`;
}

function renderMessageFrame(
  className: string,
  title: string,
  createdAt: string,
  content: string,
): string {
  return [
    `<article class="message ${className}">`,
    `<h2>${escapeHtml(title)}</h2>`,
    `<time datetime="${escapeHtml(createdAt)}">${escapeHtml(createdAt)}</time>`,
    `<div class="content">${content}</div>`,
    "</article>",
  ].join("\n");
}

function renderTextBlock(text: string): string {
  return `<pre class="text">${escapeHtml(text)}</pre>`;
}

function renderUserContent(content: ConversationUserMessage["content"]): string {
  if (typeof content === "string") {
    return renderTextBlock(content);
  }

  return content
    .map((item) =>
      item.type === "text"
        ? renderTextBlock(item.text)
        : `<p class="attachment">Image: ${escapeHtml(item.mimeType)}, ${item.data.length} bytes base64</p>`,
    )
    .join("\n");
}

function renderImageAndTextContent(content: ConversationToolResultMessage["content"]): string {
  return content
    .map((item) =>
      item.type === "text"
        ? renderTextBlock(item.text)
        : `<p class="attachment">Image: ${escapeHtml(item.mimeType)}, ${item.data.length} bytes base64</p>`,
    )
    .join("\n");
}

function renderPlainImageAndTextContent(content: ConversationToolResultMessage["content"]): string {
  return content
    .map((item) =>
      item.type === "text"
        ? item.text
        : `Image: ${item.mimeType}, ${item.data.length} bytes base64`,
    )
    .join("\n");
}

function renderTruncatedContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return renderTextBlock(content);
  }

  return [
    renderTextBlock(`${content.slice(0, maxLength)}\n... output truncated in readable export mode ...`),
    '<p class="muted">Use full export mode for complete tool output.</p>',
  ].join("\n");
}

function renderMetadataList(rows: Array<[string, string]>): string {
  return [
    '<dl class="metadata compact">',
    ...rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`),
    "</dl>",
  ].join("\n");
}

function summarizeToolArguments(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return "Arguments omitted in readable export mode.";
  }

  const record = args as Record<string, unknown>;
  for (const key of ["cmd", "command", "query", "path", "file"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return `${key}: ${value}`;
    }
  }

  return "Arguments omitted in readable export mode.";
}

function renderCss(): string {
  return `
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      color: #171717;
      background: #f6f7f9;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    header, .message {
      max-width: 960px;
      margin: 0 auto 18px;
      background: #ffffff;
      border: 1px solid #d9dee7;
      border-radius: 8px;
      padding: 20px;
    }
    h1, h2, h4 {
      margin: 0 0 12px;
      line-height: 1.2;
    }
    h1 {
      font-size: 28px;
    }
    h2 {
      font-size: 18px;
    }
    h4 {
      font-size: 14px;
    }
    time, .muted {
      color: #5f6b7a;
      font-size: 13px;
    }
    .metadata {
      display: grid;
      gap: 8px;
      margin: 0;
    }
    .metadata div {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 12px;
    }
    .metadata.compact {
      margin: 12px 0;
    }
    dt {
      color: #5f6b7a;
      font-weight: 600;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    pre {
      margin: 12px 0;
      padding: 12px;
      overflow-x: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #f1f3f6;
      border: 1px solid #d9dee7;
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
    }
    details {
      margin: 12px 0;
      padding: 12px;
      border: 1px solid #d9dee7;
      border-radius: 8px;
      background: #fbfcfd;
    }
    summary {
      cursor: pointer;
      font-weight: 700;
    }
    .assistant {
      border-left: 4px solid #2f6fed;
    }
    .user {
      border-left: 4px solid #1b8a5a;
    }
    .tool-result {
      border-left: 4px solid #6f7785;
    }
    .attachment {
      color: #5f6b7a;
      font-style: italic;
    }
    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }
      header, .message {
        break-inside: avoid;
        border-color: #c9cdd4;
      }
    }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replaceAll(/[\\/]/g, "_");
  return sanitized.length === 0 || sanitized === "." || sanitized === ".." ? "_" : sanitized;
}

function formatExportTimestamp(value: string): string {
  return value.replaceAll(/[^0-9A-Za-z.-]/g, "-");
}
