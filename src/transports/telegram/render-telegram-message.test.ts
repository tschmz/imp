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
});
