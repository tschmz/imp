type Segment =
  | { type: "text"; value: string }
  | { type: "codeBlock"; value: string; language?: string }
  | { type: "blockquote"; value: string };

type InlineSegment =
  | { type: "text"; value: string }
  | { type: "inlineCode"; value: string };

type RichTextSegment =
  | { type: "text"; value: string }
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

  for (const segment of splitInlineCode(text)) {
    if (segment.type === "inlineCode") {
      units.push(...splitInlineCodeUnit(segment.value, maxLength));
      continue;
    }

    units.push(...splitRenderedRichText(segment.value, maxLength));
  }

  return units;
}

function splitInlineCode(text: string): InlineSegment[] {
  const result: InlineSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const codeStart = text.indexOf("`", cursor);
    if (codeStart === -1) {
      result.push({ type: "text", value: text.slice(cursor) });
      break;
    }

    const codeEnd = text.indexOf("`", codeStart + 1);
    if (codeEnd === -1 || text.slice(codeStart + 1, codeEnd).includes("\n")) {
      result.push({ type: "text", value: text.slice(cursor) });
      break;
    }

    if (codeStart > cursor) {
      result.push({ type: "text", value: text.slice(cursor, codeStart) });
    }

    result.push({ type: "inlineCode", value: text.slice(codeStart + 1, codeEnd) });
    cursor = codeEnd + 1;
  }

  return result;
}

function renderInlineCode(text: string): string {
  return splitInlineCode(text)
    .map((segment) => {
      if (segment.type === "inlineCode") {
        return `<code>${escapeHtml(segment.value)}</code>`;
      }

      return renderRichText(segment.value);
    })
    .join("");
}

function splitRenderedRichText(text: string, maxLength: number): string[] {
  const units: string[] = [];

  for (const segment of splitRichText(text)) {
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

function renderRichText(text: string): string {
  return splitRichText(text)
    .map((segment) => {
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

function splitRichText(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];

  for (const linkSegment of splitLinks(text)) {
    if (linkSegment.type === "link") {
      segments.push(linkSegment);
      continue;
    }

    for (const emphasisSegment of splitEmphasis(linkSegment.value)) {
      segments.push(emphasisSegment);
    }
  }

  return segments;
}

function splitEmphasis(text: string): RichTextSegment[] {
  const result: RichTextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const boldStart = text.indexOf("**", cursor);
    const italicStart = findItalicStart(text, cursor);
    const nextToken = pickNextToken(boldStart, italicStart);

    if (!nextToken) {
      result.push({ type: "text", value: text.slice(cursor) });
      break;
    }

    if (nextToken.start > cursor) {
      result.push({ type: "text", value: text.slice(cursor, nextToken.start) });
    }

    if (nextToken.type === "bold") {
      const boldEnd = text.indexOf("**", nextToken.start + 2);
      if (boldEnd === -1) {
        result.push({ type: "text", value: text.slice(nextToken.start) });
        break;
      }

      const boldValue = text.slice(nextToken.start + 2, boldEnd);
      if (!boldValue) {
        result.push({ type: "text", value: text.slice(nextToken.start, boldEnd + 2) });
      } else {
        result.push({ type: "bold", value: boldValue });
      }
      cursor = boldEnd + 2;
      continue;
    }

    const italicEnd = findItalicEnd(text, nextToken.start + 1);
    if (italicEnd === -1) {
      result.push({ type: "text", value: text.slice(nextToken.start) });
      break;
    }

    const italicValue = text.slice(nextToken.start + 1, italicEnd);
    if (!italicValue) {
      result.push({ type: "text", value: text.slice(nextToken.start, italicEnd + 1) });
    } else {
      result.push({ type: "italic", value: italicValue });
    }
    cursor = italicEnd + 1;
  }

  return result;
}

function splitLinks(text: string): RichTextSegment[] {
  const result: RichTextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const labelStart = text.indexOf("[", cursor);
    if (labelStart === -1) {
      result.push({ type: "text", value: text.slice(cursor) });
      break;
    }

    if (labelStart > cursor) {
      result.push({ type: "text", value: text.slice(cursor, labelStart) });
    }

    const labelEnd = text.indexOf("]", labelStart + 1);
    if (labelEnd === -1) {
      result.push({ type: "text", value: "[" });
      cursor = labelStart + 1;
      continue;
    }

    if (text[labelEnd + 1] !== "(") {
      result.push({ type: "text", value: text.slice(labelStart, labelEnd + 1) });
      cursor = labelEnd + 1;
      continue;
    }

    const urlStart = labelEnd + 1;
    const urlEnd = text.indexOf(")", urlStart + 1);
    if (urlEnd === -1) {
      result.push({ type: "text", value: "[" });
      cursor = labelStart + 1;
      continue;
    }

    const label = text.slice(labelStart + 1, labelEnd);
    const href = text.slice(urlStart + 1, urlEnd).trim();
    if (href.includes("[") || !label || !isSafeLinkTarget(href)) {
      if (href.includes("[")) {
        result.push({ type: "text", value: "[" });
        cursor = labelStart + 1;
        continue;
      }

      result.push({ type: "text", value: text.slice(labelStart, urlEnd + 1) });
    } else {
      result.push({ type: "link", label, href });
    }

    cursor = urlEnd + 1;
  }

  return result;
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

function pickNextToken(
  boldStart: number,
  italicStart: number,
): { type: "bold" | "italic"; start: number } | undefined {
  if (boldStart === -1 && italicStart === -1) {
    return undefined;
  }

  if (boldStart !== -1 && (italicStart === -1 || boldStart <= italicStart)) {
    return { type: "bold", start: boldStart };
  }

  return { type: "italic", start: italicStart };
}

function findItalicStart(text: string, fromIndex: number): number {
  let cursor = fromIndex;

  while (cursor < text.length) {
    const start = text.indexOf("_", cursor);
    if (start === -1) {
      return -1;
    }

    if (isValidItalicBoundary(text, start - 1) && findItalicEnd(text, start + 1) !== -1) {
      return start;
    }

    cursor = start + 1;
  }

  return -1;
}

function findItalicEnd(text: string, fromIndex: number): number {
  let cursor = fromIndex;

  while (cursor < text.length) {
    const end = text.indexOf("_", cursor);
    if (end === -1) {
      return -1;
    }

    const content = text.slice(fromIndex, end);
    if (content && !content.includes("\n") && isValidItalicBoundary(text, end + 1)) {
      return end;
    }

    cursor = end + 1;
  }

  return -1;
}

function isValidItalicBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return true;
  }

  const value = text[index]!;
  return !/[a-z0-9]/i.test(value);
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
