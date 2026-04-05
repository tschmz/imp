import { describe, expect, it } from "vitest";
import { renderTelegramMessage } from "./render-telegram-message.js";

describe("renderTelegramMessage", () => {
  it("escapes Telegram HTML control characters", () => {
    expect(renderTelegramMessage("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("preserves plain text formatting like newlines", () => {
    expect(renderTelegramMessage("first line\n\nsecond line")).toBe("first line\n\nsecond line");
  });

  it("does not escape quotes", () => {
    expect(renderTelegramMessage(`say "hi" & it's <fine>`)).toBe(
      `say "hi" &amp; it's &lt;fine&gt;`,
    );
  });

  it("renders inline code as Telegram HTML", () => {
    expect(renderTelegramMessage("Use `npm test` here.")).toBe(
      "Use <code>npm test</code> here.",
    );
  });

  it("renders fenced code blocks as Telegram HTML", () => {
    expect(renderTelegramMessage("Before\n```const x = 1 < 2;\n```\nAfter")).toBe(
      "Before\n<pre><code>const x = 1 &lt; 2;\n</code></pre>\nAfter",
    );
  });

  it("renders fenced code blocks with a language hint", () => {
    expect(renderTelegramMessage("```ts\nconst value = 1;\n```")).toBe(
      '<pre><code class="language-ts">const value = 1;\n</code></pre>',
    );
  });

  it("does not parse inline code markers inside fenced code blocks", () => {
    expect(renderTelegramMessage("```ts\nconst cmd = `npm test`;\n```")).toBe(
      '<pre><code class="language-ts">const cmd = `npm test`;\n</code></pre>',
    );
  });

  it("leaves unmatched backticks as plain text", () => {
    expect(renderTelegramMessage("Use `npm test here.")).toBe("Use `npm test here.");
  });
});
