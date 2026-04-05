type Segment =
  | { type: "text"; value: string }
  | { type: "codeBlock"; value: string; language?: string };

type InlineSegment =
  | { type: "text"; value: string }
  | { type: "inlineCode"; value: string };

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
      segments.push({ type: "text", value: text.slice(cursor) });
      break;
    }

    if (blockStart > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, blockStart) });
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

      return renderInlineCode(segment.value);
    })
    .join("");
}

function renderSegmentUnits(segment: Segment, maxLength: number): string[] {
  if (segment.type === "codeBlock") {
    return splitRenderedCodeBlock(segment, maxLength);
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

    units.push(...splitEscapedText(segment.value, maxLength));
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
    .map((segment) =>
      segment.type === "inlineCode"
        ? `<code>${escapeHtml(segment.value)}</code>`
        : escapeHtml(segment.value),
    )
    .join("");
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
  const prefix = "<code>";
  const suffix = "</code>";
  const contentLimit = maxLength - prefix.length - suffix.length;

  if (contentLimit <= 0) {
    throw new Error(`Telegram message limit ${maxLength} is too small for inline code wrappers.`);
  }

  const parts = splitByEscapedLength(value, contentLimit);
  return parts.map((part) => `${prefix}${escapeHtml(part)}</code>`);
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
