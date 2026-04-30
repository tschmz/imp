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


  it("does not include the next job heading in the previous markdown instruction", () => {
    const result = parseCronMarkdown(`${example}
## zweite-suche

\`\`\`json imp-cron
{
  "id": "zweite-suche",
  "enabled": true,
  "schedule": "30 8 * * *",
  "timezone": "Europe/Berlin",
  "reply": {
    "type": "none"
  },
  "session": {
    "mode": "detached",
    "id": "zweite-suche",
    "title": "Zweite Suche"
  }
}
\`\`\`

Suche später nochmal.
`);

    expect(result.issues).toEqual([]);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.instruction).toBe("Suche täglich nach Wohnungen.");
    expect(result.jobs[1]?.instruction).toBe("Suche später nochmal.");
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
