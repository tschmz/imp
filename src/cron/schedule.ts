const minuteMs = 60_000;
const maxScanMinutes = 60 * 24 * 366;

interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

interface ParsedCronExpression {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

export function getNextCronRun(expression: string, options: { after?: Date; timezone?: string } = {}): Date {
  const parsed = parseCronExpression(expression);
  const timezone = options.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const start = options.after ?? new Date();
  let candidate = new Date(Math.floor(start.getTime() / minuteMs) * minuteMs + minuteMs);

  for (let index = 0; index < maxScanMinutes; index += 1) {
    const parts = getZonedParts(candidate, timezone);
    if (matchesCronExpression(parsed, parts)) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + minuteMs);
  }

  throw new Error(`Cron expression did not match within one year: ${expression}`);
}

export function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("Cron schedule must contain five fields: minute hour day-of-month month day-of-week.");
  }

  return {
    minute: parseField(fields[0]!, 0, 59, "minute"),
    hour: parseField(fields[1]!, 0, 23, "hour"),
    dayOfMonth: parseField(fields[2]!, 1, 31, "day-of-month"),
    month: parseField(fields[3]!, 1, 12, "month"),
    dayOfWeek: parseField(fields[4]!, 0, 7, "day-of-week"),
  };
}

function parseField(field: string, min: number, max: number, label: string): CronField {
  const values = new Set<number>();
  const parts = field.split(",").map((part) => part.trim());
  for (const part of parts) {
    parseFieldPart(part, min, max, label).forEach((value) => values.add(value));
  }
  if (values.size === 0) {
    throw new Error(`Cron ${label} field is empty.`);
  }
  return { values, wildcard: parts.includes("*") };
}

function parseFieldPart(part: string, min: number, max: number, label: string): number[] {
  if (!part) {
    throw new Error(`Cron ${label} field contains an empty list item.`);
  }

  const [rangePart, stepPart] = part.split("/");
  if (part.split("/").length > 2) {
    throw new Error(`Cron ${label} field contains an invalid step: ${part}`);
  }
  const step = stepPart === undefined ? 1 : parseNumber(stepPart, 1, max, label);
  const [start, end] = parseRange(rangePart ?? "", min, max, label);
  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(normalizeDayOfWeek(value, label));
  }
  return values;
}

function parseRange(part: string, min: number, max: number, label: string): [number, number] {
  if (part === "*") {
    return [min, max];
  }
  if (part.includes("-")) {
    const [left, right] = part.split("-");
    if (!left || !right || part.split("-").length !== 2) {
      throw new Error(`Cron ${label} field contains an invalid range: ${part}`);
    }
    const start = parseNumber(left, min, max, label);
    const end = parseNumber(right, min, max, label);
    if (start > end) {
      throw new Error(`Cron ${label} range start must be <= end: ${part}`);
    }
    return [start, end];
  }
  const value = parseNumber(part, min, max, label);
  return [value, value];
}

function parseNumber(value: string, min: number, max: number, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Cron ${label} field contains a non-numeric value: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Cron ${label} value must be between ${min} and ${max}: ${value}`);
  }
  return parsed;
}

function normalizeDayOfWeek(value: number, label: string): number {
  return label === "day-of-week" && value === 7 ? 0 : value;
}

function matchesCronExpression(expression: ParsedCronExpression, parts: ZonedParts): boolean {
  const dayOfMonthMatches = expression.dayOfMonth.values.has(parts.day);
  const dayOfWeekMatches = expression.dayOfWeek.values.has(parts.dayOfWeek);
  const dayMatches = expression.dayOfMonth.wildcard || expression.dayOfWeek.wildcard
    ? dayOfMonthMatches && dayOfWeekMatches
    : dayOfMonthMatches || dayOfWeekMatches;

  return expression.minute.values.has(parts.minute) &&
    expression.hour.values.has(parts.hour) &&
    expression.month.values.has(parts.month) &&
    dayMatches;
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const weekday = getPart(parts, "weekday");
  return {
    year: Number(getPart(parts, "year")),
    month: Number(getPart(parts, "month")),
    day: Number(getPart(parts, "day")),
    hour: Number(getPart(parts, "hour")),
    minute: Number(getPart(parts, "minute")),
    dayOfWeek: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday),
  };
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}
