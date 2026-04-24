import { fromMarkdown } from "mdast-util-from-markdown";
import type { List, ListItem, PhrasingContent, RootContent } from "mdast";

type Segment =
  | { type: "text"; value: string }
  | { type: "codeBlock"; value: string; language?: string }
  | { type: "blockquote"; value: string };

type RichTextSegment =
  | { type: "text"; value: string }
  | { type: "inlineCode"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "link"; label: string; href: string };

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function renderTelegramMessage(text: string): string {
  return renderSegments(splitCodeBlocks(text));
}

export function renderTelegramMessages(
  text: string,
  maxLength = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  const units = splitCodeBlocks(text).flatMap((segment) => renderSegmentUnits(segment, maxLength));
  const messages = combineUnits(units, maxLength);

  return messages.length > 0 ? messages : [""];
}

function splitCodeBlocks(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const blockStart = text.indexOf("```", cursor);
    if (blockStart === -1) {
      segments.push(...splitBlockQuotes(text.slice(cursor)));
      break;
    }

    if (blockStart > cursor) {
      segments.push(...splitBlockQuotes(text.slice(cursor, blockStart)));
    }

    const blockEnd = text.indexOf("```", blockStart + 3);
    if (blockEnd === -1) {
      segments.push({ type: "text", value: text.slice(blockStart) });
      break;
    }

    const blockContent = text.slice(blockStart + 3, blockEnd);
    segments.push(toCodeBlockSegment(blockContent));
    cursor = blockEnd + 3;
  }

  return segments;
}

function toCodeBlockSegment(blockContent: string): Segment {
  const normalized = blockContent.startsWith("\n") ? blockContent.slice(1) : blockContent;
  const firstLineBreak = normalized.indexOf("\n");

  if (firstLineBreak === -1) {
    return {
      type: "codeBlock",
      value: normalized,
    };
  }

  const firstLine = normalized.slice(0, firstLineBreak).trim();
  if (!isSupportedLanguageHint(firstLine)) {
    return {
      type: "codeBlock",
      value: normalized,
    };
  }

  return {
    type: "codeBlock",
    language: firstLine,
    value: normalized.slice(firstLineBreak + 1),
  };
}

function isSupportedLanguageHint(value: string): boolean {
  return /^[a-z0-9_+-]+$/i.test(value);
}

function renderSegments(segments: Segment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "codeBlock") {
        const escapedCode = escapeHtml(segment.value);
        if (segment.language) {
          return `<pre><code class="language-${segment.language}">${escapedCode}</code></pre>`;
        }

        return `<pre><code>${escapedCode}</code></pre>`;
      }

      if (segment.type === "blockquote") {
        return `<blockquote>${renderInlineCode(segment.value)}</blockquote>`;
      }

      return renderInlineCode(segment.value);
    })
    .join("");
}

function renderSegmentUnits(segment: Segment, maxLength: number): string[] {
  if (segment.type === "codeBlock") {
    return splitRenderedCodeBlock(segment, maxLength);
  }

  if (segment.type === "blockquote") {
    return splitRenderedBlockQuote(segment.value, maxLength);
  }

  return splitRenderedText(segment.value, maxLength);
}

function splitRenderedText(text: string, maxLength: number): string[] {
  const units: string[] = [];

  for (const segment of parseRichText(text)) {
    if (segment.type === "inlineCode") {
      units.push(...splitInlineCodeUnit(segment.value, maxLength));
      continue;
    }

    if (segment.type === "bold") {
      units.push(...splitWrappedUnit(segment.value, maxLength, "<b>", "</b>", "bold"));
      continue;
    }

    if (segment.type === "italic") {
      units.push(...splitWrappedUnit(segment.value, maxLength, "<i>", "</i>", "italic"));
      continue;
    }

    if (segment.type === "link") {
      units.push(...splitLinkUnit(segment.label, segment.href, maxLength));
      continue;
    }

    units.push(...splitEscapedText(segment.value, maxLength));
  }

  return units;
}

function renderInlineCode(text: string): string {
  return parseRichText(text)
    .map((segment) => {
      if (segment.type === "inlineCode") {
        return `<code>${escapeHtml(segment.value)}</code>`;
      }

      if (segment.type === "bold") {
        return `<b>${escapeHtml(segment.value)}</b>`;
      }

      if (segment.type === "italic") {
        return `<i>${escapeHtml(segment.value)}</i>`;
      }

      if (segment.type === "link") {
        return `<a href="${escapeHtmlAttribute(segment.href)}">${escapeHtml(segment.label)}</a>`;
      }

      return escapeHtml(segment.value);
    })
    .join("");
}

function parseRichText(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const tree = fromMarkdown(text);
  let cursor = 0;

  for (const child of tree.children) {
    const start = getStartOffset(child);
    const end = getEndOffset(child);
    if (start !== undefined && start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }

    segments.push(...renderMarkdownNodeAsSegments(child, text));
    if (end !== undefined) {
      cursor = end;
    }
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}

function renderMarkdownNodeAsSegments(node: RootContent, source: string): RichTextSegment[] {
  switch (node.type) {
    case "list":
      return renderListNodeAsSegments(node, source);
    case "paragraph":
    case "heading":
      return renderPhrasingNodesAsSegments(node.children, source);
    case "text":
      return [{ type: "text", value: node.value }];
    case "inlineCode":
      return [{ type: "inlineCode", value: node.value }];
    case "emphasis":
      return [{ type: "italic", value: renderPhrasingNodesAsPlainText(node.children) }];
    case "strong":
      return [{ type: "bold", value: renderPhrasingNodesAsPlainText(node.children) }];
    case "link":
      return isSafeLinkTarget(node.url)
        ? [{ type: "link", label: renderPhrasingNodesAsPlainText(node.children), href: node.url }]
        : [{ type: "text", value: source.slice(getStartOffset(node) ?? 0, getEndOffset(node) ?? source.length) }];
    case "break":
      return [{ type: "text", value: "\n" }];
    default:
      return [{ type: "text", value: source.slice(getStartOffset(node) ?? 0, getEndOffset(node) ?? source.length) }];
  }
}

function renderListNodeAsSegments(node: List, source: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];

  node.children.forEach((item, index) => {
    if (index > 0) {
      segments.push({ type: "text", value: node.spread || item.spread ? "\n\n" : "\n" });
    }

    segments.push(...renderListItemAsSegments(item, source, node.ordered ? `${(node.start ?? 1) + index}. ` : "- "));
  });

  return segments;
}

function renderListItemAsSegments(
  item: ListItem,
  source: string,
  marker: string,
): RichTextSegment[] {
  const segments: RichTextSegment[] = [{ type: "text", value: marker }];

  item.children.forEach((child, index) => {
    if (index > 0) {
      segments.push({ type: "text", value: "\n" });
    }

    segments.push(...renderMarkdownNodeAsSegments(child, source));
  });

  return segments;
}

function renderPhrasingNodesAsSegments(nodes: PhrasingContent[], source: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  for (const node of nodes) {
    segments.push(...renderMarkdownNodeAsSegments(node, source));
  }
  return segments;
}

function renderPhrasingNodesAsPlainText(nodes: PhrasingContent[]): string {
  return nodes.map((node) => {
    switch (node.type) {
      case "text":
      case "inlineCode":
        return node.value;
      case "emphasis":
      case "strong":
      case "link":
        return renderPhrasingNodesAsPlainText(node.children);
      case "break":
        return "\n";
      default:
        return "";
    }
  }).join("");
}

function getStartOffset(node: RootContent | PhrasingContent): number | undefined {
  return node.position?.start.offset;
}

function getEndOffset(node: RootContent | PhrasingContent): number | undefined {
  return node.position?.end.offset;
}

function splitBlockQuotes(text: string): Segment[] {
  const segments: Segment[] = [];
  const blockQuoteRegex = /^>.*(?:\n>.*)*/gm;
  let cursor = 0;
  let match = blockQuoteRegex.exec(text);

  while (match) {
    const blockStart = match.index;
    const blockValue = match[0]!;

    if (blockStart > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, blockStart) });
    }

    const quoteLines = blockValue
      .split("\n")
      .map((line) => line.slice(line.startsWith("> ") ? 2 : 1));
    segments.push({ type: "blockquote", value: quoteLines.join("\n") });

    cursor = blockStart + blockValue.length;
    match = blockQuoteRegex.exec(text);
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}

function splitRenderedCodeBlock(segment: Extract<Segment, { type: "codeBlock" }>, maxLength: number): string[] {
  const prefix = segment.language
    ? `<pre><code class="language-${segment.language}">`
    : "<pre><code>";
  const suffix = "</code></pre>";
  const contentLimit = maxLength - prefix.length - suffix.length;

  if (contentLimit <= 0) {
    throw new Error(`Telegram message limit ${maxLength} is too small for code block wrappers.`);
  }

  const parts = splitByEscapedLength(segment.value, contentLimit);
  return parts.map((part) => `${prefix}${escapeHtml(part)}${suffix}`);
}

function splitInlineCodeUnit(value: string, maxLength: number): string[] {
  return splitWrappedUnit(value, maxLength, "<code>", "</code>", "inline code");
}

function splitWrappedUnit(
  value: string,
  maxLength: number,
  prefix: string,
  suffix: string,
  label: string,
): string[] {
  const contentLimit = maxLength - prefix.length - suffix.length;

  if (contentLimit <= 0) {
    throw new Error(`Telegram message limit ${maxLength} is too small for ${label} wrappers.`);
  }

  const parts = splitByEscapedLength(value, contentLimit);
  return parts.map((part) => `${prefix}${escapeHtml(part)}${suffix}`);
}

function splitLinkUnit(label: string, href: string, maxLength: number): string[] {
  const prefix = `<a href="${escapeHtmlAttribute(href)}">`;
  const suffix = "</a>";
  return splitWrappedUnit(label, maxLength, prefix, suffix, "link");
}

function splitRenderedBlockQuote(value: string, maxLength: number): string[] {
  const prefix = "<blockquote>";
  const suffix = "</blockquote>";
  const contentLimit = maxLength - prefix.length - suffix.length;

  if (contentLimit <= 0) {
    throw new Error(`Telegram message limit ${maxLength} is too small for blockquote wrappers.`);
  }

  const innerUnits = splitRenderedText(value, contentLimit);
  return combineUnits(innerUnits, contentLimit).map((unit) => `${prefix}${unit}${suffix}`);
}

function splitEscapedText(value: string, maxLength: number): string[] {
  return splitByEscapedLength(value, maxLength).map((part) => escapeHtml(part));
}

function splitByEscapedLength(value: string, maxLength: number): string[] {
  if (!value) {
    return [];
  }

  const parts: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    let end = cursor;
    let escapedLength = 0;
    let lastBreak = -1;

    while (end < value.length) {
      const nextLength = escapedLength + escapedCharLength(value[end]!);
      if (nextLength > maxLength) {
        break;
      }

      escapedLength = nextLength;
      if (isPreferredBreakCharacter(value[end]!)) {
        lastBreak = end + 1;
      }
      end += 1;
    }

    if (end === cursor) {
      end += 1;
    } else if (end < value.length && lastBreak > cursor) {
      end = lastBreak;
    }

    parts.push(value.slice(cursor, end));
    cursor = end;
  }

  return parts;
}

function combineUnits(units: string[], maxLength: number): string[] {
  const messages: string[] = [];
  let current = "";

  for (const unit of units) {
    if (!unit) {
      continue;
    }

    if (unit.length > maxLength) {
      throw new Error("Rendered Telegram unit exceeds message length limit.");
    }

    if (!current) {
      current = unit;
      continue;
    }

    if (current.length + unit.length <= maxLength) {
      current += unit;
      continue;
    }

    messages.push(current);
    current = unit;
  }

  if (current) {
    messages.push(current);
  }

  return messages;
}

function escapedCharLength(value: string): number {
  if (value === "&") {
    return 5;
  }

  if (value === "<" || value === ">") {
    return 4;
  }

  return 1;
}

function isPreferredBreakCharacter(value: string): boolean {
  return value === "\n" || value === " " || value === "\t";
}

function isSafeLinkTarget(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:", "tg:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
