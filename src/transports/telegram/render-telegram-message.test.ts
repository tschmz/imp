import { describe, expect, it } from "vitest";
import { renderTelegramMessage, renderTelegramMessages } from "./render-telegram-message.js";

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

  it("renders markdown bold as Telegram HTML", () => {
    expect(renderTelegramMessage("This is **important** text.")).toBe(
      "This is <b>important</b> text.",
    );
  });

  it("leaves unmatched bold markers as plain text", () => {
    expect(renderTelegramMessage("This is **important text.")).toBe(
      "This is **important text.",
    );
  });

  it("renders markdown italic as Telegram HTML", () => {
    expect(renderTelegramMessage("This is _important_ text.")).toBe(
      "This is <i>important</i> text.",
    );
  });

  it("does not treat snake_case as italic", () => {
    expect(renderTelegramMessage("Keep snake_case untouched.")).toBe(
      "Keep snake_case untouched.",
    );
  });

  it("renders markdown links as Telegram HTML", () => {
    expect(renderTelegramMessage("Read [docs](https://example.com/docs?a=1&b=2).")).toBe(
      'Read <a href="https://example.com/docs?a=1&amp;b=2">docs</a>.',
    );
  });

  it("leaves unsafe markdown links as plain text", () => {
    expect(renderTelegramMessage("[click](javascript:alert(1))")).toBe(
      "[click](javascript:alert(1))",
    );
  });

  it("continues parsing when an invalid link is followed by a valid link", () => {
    expect(renderTelegramMessage("Broken [link](oops and [docs](https://example.com).")).toBe(
      'Broken [link](oops and <a href="https://example.com">docs</a>.',
    );
  });

  it("continues after nested or partially broken brackets and still renders later valid links", () => {
    expect(
      renderTelegramMessage(
        "Messy [outer [inner] text and [docs](https://example.com/docs?a=1&b=2)",
      ),
    ).toBe(
      'Messy [outer [inner] text and <a href="https://example.com/docs?a=1&amp;b=2">docs</a>',
    );
  });

  it("renders only links with allowed protocols", () => {
    expect(
      renderTelegramMessage(
        "Links [http](http://example.com) [https](https://example.com) [mail](mailto:test@example.com) [tg](tg://resolve?domain=example) [ftp](ftp://example.com)",
      ),
    ).toBe(
      'Links <a href="http://example.com">http</a> <a href="https://example.com">https</a> <a href="mailto:test@example.com">mail</a> <a href="tg://resolve?domain=example">tg</a> [ftp](ftp://example.com)',
    );
  });

  it("renders blockquotes as Telegram HTML", () => {
    expect(renderTelegramMessage("> first line\n> second line")).toBe(
      "<blockquote>first line\nsecond line</blockquote>",
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

  it("does not parse bold markers inside inline code", () => {
    expect(renderTelegramMessage("Use `**npm test**` here.")).toBe(
      "Use <code>**npm test**</code> here.",
    );
  });

  it("does not parse italic or links inside inline code", () => {
    expect(renderTelegramMessage("Use `_npm_ [docs](https://example.com)` here.")).toBe(
      "Use <code>_npm_ [docs](https://example.com)</code> here.",
    );
  });

  it("does not parse bold markers inside fenced code blocks", () => {
    expect(renderTelegramMessage("```**bold**```")).toBe(
      "<pre><code>**bold**</code></pre>",
    );
  });

  it("renders rich text inside blockquotes", () => {
    expect(renderTelegramMessage("> see **this** and _that_ [doc](https://example.com)")).toBe(
      '<blockquote>see <b>this</b> and <i>that</i> <a href="https://example.com">doc</a></blockquote>',
    );
  });

  it("chunks long plain text messages", () => {
    expect(renderTelegramMessages("hello world there", 11)).toEqual(["hello ", "world there"]);
  });

  it("keeps inline code balanced across chunks", () => {
    expect(renderTelegramMessages("Use `abcdefghij` now", 18)).toEqual([
      "Use ",
      "<code>abcde</code>",
      "<code>fghij</code>",
      " now",
    ]);
  });

  it("keeps bold balanced across chunks", () => {
    expect(renderTelegramMessages("Start **abcdefghij** end", 14)).toEqual([
      "Start ",
      "<b>abcdefg</b>",
      "<b>hij</b> end",
    ]);
  });

  it("keeps italic balanced across chunks", () => {
    expect(renderTelegramMessages("Start _abcdefghij_ end", 14)).toEqual([
      "Start ",
      "<i>abcdefg</i>",
      "<i>hij</i> end",
    ]);
  });

  it("keeps links balanced across chunks", () => {
    expect(renderTelegramMessages("See [abcdefghij](https://example.com) now", 45)).toEqual([
      "See ",
      '<a href="https://example.com">abcdefghij</a>',
      " now",
    ]);
  });

  it("keeps blockquotes balanced across chunks", () => {
    expect(renderTelegramMessages("> abcdefghijklmnop", 35)).toEqual([
      "<blockquote>abcdefghij</blockquote>",
      "<blockquote>klmnop</blockquote>",
    ]);
  });

  it("splits oversized code blocks into multiple balanced code blocks", () => {
    expect(renderTelegramMessages("```abcdefghij```", 40)).toEqual([
      "<pre><code>abcdefghij</code></pre>",
    ]);
    expect(renderTelegramMessages("```abcdefghijk```", 34)).toEqual([
      "<pre><code>abcdefghij</code></pre>",
      "<pre><code>k</code></pre>",
    ]);
  });
});
