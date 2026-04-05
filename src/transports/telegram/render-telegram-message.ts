export function renderTelegramMessage(text: string): string {
  return renderSegments(splitCodeBlocks(text));
}

type Segment =
  | { type: "text"; value: string }
  | { type: "codeBlock"; value: string; language?: string };

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

function renderInlineCode(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const codeStart = text.indexOf("`", cursor);
    if (codeStart === -1) {
      result += escapeHtml(text.slice(cursor));
      break;
    }

    const codeEnd = text.indexOf("`", codeStart + 1);
    if (codeEnd === -1 || text.slice(codeStart + 1, codeEnd).includes("\n")) {
      result += escapeHtml(text.slice(cursor));
      break;
    }

    result += escapeHtml(text.slice(cursor, codeStart));
    result += `<code>${escapeHtml(text.slice(codeStart + 1, codeEnd))}</code>`;
    cursor = codeEnd + 1;
  }

  return result;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
