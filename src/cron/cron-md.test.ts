import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCronMarkdown, renderCronMarkdown, upsertAgentCronJob } from "./cron-md.js";

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


  it("accepts cron jobs that activate their session", () => {
    const result = parseCronMarkdown(example.replace('"mode": "detached"', '"mode": "activate"'));

    expect(result.issues).toEqual([]);
    expect(result.jobs[0]?.session.mode).toBe("activate");
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

  it("rejects upserts that would render an unparsable cron file", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-cron-invalid-upsert-"));

    try {
      await expect(upsertAgentCronJob(root, {
        id: "bad id",
        enabled: true,
        schedule: "0 8 * * *",
        reply: { type: "none" },
        session: { mode: "detached", id: "daily" },
        instruction: "Run daily.",
      })).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves concurrent cron job upserts", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-cron-concurrent-upsert-"));

    try {
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          upsertAgentCronJob(root, {
            id: `job-${index}`,
            enabled: true,
            schedule: "0 8 * * *",
            reply: { type: "none" },
            session: { mode: "detached", id: `job-${index}` },
            instruction: `Run job ${index}.`,
          })
        ),
      );

      const result = parseCronMarkdown(await readFile(join(root, "cron.md"), "utf8"));

      expect(result.issues).toEqual([]);
      expect(result.jobs.map((job) => job.id).sort()).toEqual(
        Array.from({ length: 10 }, (_, index) => `job-${index}`),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
