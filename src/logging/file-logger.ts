import { appendFile } from "node:fs/promises";
import { asAppError } from "../domain/errors.js";
import type { LogFields, Logger, LogLevel } from "./types.js";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createFileLogger(path: string, level: LogLevel = "info"): Logger {
  return {
    async debug(message: string, fields?: LogFields): Promise<void> {
      if (!shouldLog("debug", level)) {
        return;
      }

      await writeLogLine(path, "DEBUG", message, fields);
      console.debug(formatConsoleLog(message, fields));
    },
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

      const appError = error === undefined ? undefined : asAppError(error);
      const errorFields = appError ? { ...(fields ?? {}), errorCode: appError.code } : fields;

      await writeLogLine(path, "ERROR", message, errorFields);
      if (appError !== undefined) {
        await writeLogLine(path, "ERROR", formatError(appError), errorFields);
      }

      console.error(formatConsoleLog(message, errorFields));
      if (appError !== undefined) {
        console.error(appError);
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

function formatError(error: Error): string {
  return error.stack ?? `${error.name}: ${error.message}`;
}

function formatConsoleLog(message: string, fields?: LogFields): string {
  if (!fields || Object.keys(fields).length === 0) {
    return message;
  }

  return `${message} ${JSON.stringify(fields)}`;
}
