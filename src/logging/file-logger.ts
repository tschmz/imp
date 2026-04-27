import { appendFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isMissingFileError } from "../files/node-error.js";
import type { LogErrorFields, LogFields, Logger, LogLevel } from "./types.js";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createFileLogger(path: string, level: LogLevel = "info"): Logger {
  return createFileLoggerWithOptions(path, level, { writeConsole: true });
}

export function createFileOnlyLogger(path: string, level: LogLevel = "info"): Logger {
  return createFileLoggerWithOptions(path, level, { writeConsole: false });
}

function createFileLoggerWithOptions(
  path: string,
  level: LogLevel,
  options: { writeConsole: boolean },
): Logger {
  return {
    async debug(message: string, fields?: LogFields): Promise<void> {
      if (!shouldLog("debug", level)) {
        return;
      }

      await writeLogLine(path, "debug", message, fields);
      if (options.writeConsole) {
        console.debug(formatConsoleLog(message, fields));
      }
    },
    async info(message: string, fields?: LogFields): Promise<void> {
      if (!shouldLog("info", level)) {
        return;
      }

      await writeLogLine(path, "info", message, fields);
      if (options.writeConsole) {
        console.log(formatConsoleLog(message, fields));
      }
    },
    async error(message: string, fields?: LogFields, error?: unknown): Promise<void> {
      if (!shouldLog("error", level)) {
        return;
      }

      await writeLogLine(path, "error", message, fields, error);

      if (options.writeConsole) {
        console.error(formatConsoleLog(message, fields));
        if (error !== undefined) {
          console.error(error);
        }
      }
    },
  };
}

export async function rotateLogFileOnStartup(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const hasContent = await hasExistingLogContent(path);
  if (hasContent) {
    await rename(path, await resolveNextRotatedLogFilePath(path));
  }

  await writeFile(path, "", { encoding: "utf8", flag: "w" });
}

async function resolveNextRotatedLogFilePath(path: string): Promise<string> {
  let index = 1;
  while (await pathExists(`${path}.${index}`)) {
    index += 1;
  }

  return `${path}.${index}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

async function hasExistingLogContent(path: string): Promise<boolean> {
  try {
    const fileStats = await stat(path);
    return fileStats.size > 0;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function shouldLog(entryLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[entryLevel] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

async function writeLogLine(
  path: string,
  level: LogLevel,
  message: string,
  fields?: LogFields,
  error?: unknown,
): Promise<void> {
  const { event, error: fieldError, ...restFields } = fields ?? {};
  const payload = {
    ts: new Date().toISOString(),
    level,
    schemaVersion: 1,
    event: event ?? deriveEventName(message),
    message,
    ...restFields,
    ...(error !== undefined ? { error: formatStructuredError(error) } : fieldError ? { error: fieldError } : {}),
  };

  await appendFile(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function deriveEventName(message: string): string {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized || "log.event";
}

function formatStructuredError(error: unknown): LogErrorFields {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...formatErrorCause(error),
    };
  }

  return {
    type: typeof error,
    message: String(error),
  };
}

function formatErrorCause(error: Error): Pick<LogErrorFields, "causeType" | "causeMessage"> {
  if (!("cause" in error) || error.cause === undefined) {
    return {};
  }

  const cause = error.cause;
  if (cause instanceof Error) {
    return {
      causeType: cause.name,
      causeMessage: cause.message,
    };
  }

  return {
    causeType: typeof cause,
    causeMessage: String(cause),
  };
}

function formatConsoleLog(message: string, fields?: LogFields): string {
  if (!fields || Object.keys(fields).length === 0) {
    return message;
  }

  return `${message} ${JSON.stringify(fields)}`;
}
