import { describe, expect, it } from "vitest";
import { getNextCronRun, parseCronExpression } from "./schedule.js";

describe("cron schedule", () => {
  it("parses standard five-field cron expressions", () => {
    expect(() => parseCronExpression("*/15 8-18 * * 1-5")).not.toThrow();
  });

  it("rejects cron expressions that are not five fields", () => {
    expect(() => parseCronExpression("0 0 8 * * *")).toThrow(
      "Cron schedule must contain five fields",
    );
  });

  it("calculates the next run in the configured timezone", () => {
    const next = getNextCronRun("0 8 * * *", {
      after: new Date("2025-01-01T06:59:00.000Z"),
      timezone: "Europe/Berlin",
    });

    expect(next.toISOString()).toBe("2025-01-01T07:00:00.000Z");
  });

  it("matches either day-of-month or day-of-week when both are restricted", () => {
    const next = getNextCronRun("0 8 15 * 1", {
      after: new Date("2025-01-13T08:00:00.000Z"),
      timezone: "UTC",
    });

    expect(next.toISOString()).toBe("2025-01-15T08:00:00.000Z");
  });

  it("finds sparse schedules more than one year ahead", () => {
    const next = getNextCronRun("0 0 29 2 *", {
      after: new Date("2025-03-01T00:00:00.000Z"),
      timezone: "UTC",
    });

    expect(next.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("supports named months and weekdays", () => {
    const next = getNextCronRun("0 8 * JAN MON", {
      after: new Date("2025-01-01T08:00:00.000Z"),
      timezone: "UTC",
    });

    expect(next.toISOString()).toBe("2025-01-06T08:00:00.000Z");
  });
});
