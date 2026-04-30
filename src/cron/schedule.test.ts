import { describe, expect, it } from "vitest";
import { getNextCronRun, parseCronExpression } from "./schedule.js";

describe("cron schedule", () => {
  it("parses standard five-field cron expressions", () => {
    expect(() => parseCronExpression("*/15 8-18 * * 1-5")).not.toThrow();
  });

  it("calculates the next run in the configured timezone", () => {
    const next = getNextCronRun("0 8 * * *", {
      after: new Date("2025-01-01T06:59:00.000Z"),
      timezone: "Europe/Berlin",
    });

    expect(next.toISOString()).toBe("2025-01-01T07:00:00.000Z");
  });
});
