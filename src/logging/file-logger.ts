import { appendFile } from "node:fs/promises";
import type { LogFields, Logger, LogLevel } from "./types.js";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createFileLogger(path: string, level: LogLevel = "info"): Logger {
  return {
    async info(message: string, fields?: LogFields): Promise<void> {
      if (!shouldLog("info", level)) {
        return;
      }

      await writeLogLine(path, "INFO", message, fields);
      console.log(formatConsoleLog(message, fields));
    },
    async error(message: string, fields?: LogFields, error?: unknown): Promise<void> {
      if (!shouldLog("error", level)) {
        return;
      }

      await writeLogLine(path, "ERROR", message, fields);
      if (error !== undefined) {
        await writeLogLine(path, "ERROR", formatError(error), fields);
      }

      console.error(formatConsoleLog(message, fields));
      if (error !== undefined) {
        console.error(error);
      }
    },
  };
}

function shouldLog(entryLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[entryLevel] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

async function writeLogLine(
  path: string,
  level: string,
  message: string,
  fields?: LogFields,
): Promise<void> {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields ?? {}),
  };

  await appendFile(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}

function formatConsoleLog(message: string, fields?: LogFields): string {
  if (!fields || Object.keys(fields).length === 0) {
    return message;
  }

  return `${message} ${JSON.stringify(fields)}`;
}
