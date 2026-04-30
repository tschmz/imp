import { describe, expect, it } from "vitest";
import { parseCronMarkdown, renderCronMarkdown } from "./cron-md.js";

const example = `# Imp Cron

## wohnungssuche

\`\`\`json imp-cron
{
  "id": "wohnungssuche",
  "enabled": true,
  "schedule": "0 8 * * *",
  "timezone": "Europe/Berlin",
  "reply": {
    "type": "none"
  },
  "session": {
    "mode": "detached",
    "id": "wohnungssuche",
    "title": "Wohnungssuche"
  }
}
\`\`\`

Suche täglich nach Wohnungen.
`;

describe("parseCronMarkdown", () => {
  it("parses json imp-cron blocks with markdown instructions", () => {
    const result = parseCronMarkdown(example);

    expect(result.issues).toEqual([]);
    expect(result.jobs).toEqual([
      {
        id: "wohnungssuche",
        enabled: true,
        schedule: "0 8 * * *",
        timezone: "Europe/Berlin",
        reply: { type: "none" },
        session: { mode: "detached", id: "wohnungssuche", title: "Wohnungssuche" },
        instruction: "Suche täglich nach Wohnungen.",
      },
    ]);
  });

  it("renders jobs back as json config in markdown", () => {
    const parsed = parseCronMarkdown(example);
    const rendered = renderCronMarkdown(parsed.jobs);

    expect(rendered).toContain("```json imp-cron");
    expect(rendered).toContain('"schedule": "0 8 * * *"');
    expect(rendered).toContain("Suche täglich nach Wohnungen.");
  });

  it("reports invalid cron json", () => {
    const result = parseCronMarkdown("```json imp-cron\n{\n```\n");

    expect(result.jobs).toEqual([]);
    expect(result.issues[0]).toContain("Invalid cron JSON block");
  });
});
