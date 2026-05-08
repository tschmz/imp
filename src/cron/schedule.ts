import { CronExpressionParser, type CronExpression } from "cron-parser";

export function getNextCronRun(expression: string, options: { after?: Date; timezone?: string } = {}): Date {
  const timezone = options.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  return parseCronExpression(expression, {
    currentDate: options.after ?? new Date(),
    timezone,
  }).next().toDate();
}

export function parseCronExpression(
  expression: string,
  options: { currentDate?: Date; timezone?: string } = {},
): CronExpression {
  assertFiveFieldCronExpression(expression);
  return CronExpressionParser.parse(expression, {
    ...(options.currentDate ? { currentDate: options.currentDate } : {}),
    ...(options.timezone ? { tz: options.timezone } : {}),
  });
}

function assertFiveFieldCronExpression(expression: string): void {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new Error("Cron schedule must contain five fields: minute hour day-of-month month day-of-week.");
  }
}
