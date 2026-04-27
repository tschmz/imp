import { appendFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isMissingFileError } from "../files/node-error.js";
import type { LogFields, Logger, LogLevel } from "./types.js";

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

      await writeLogLine(path, "DEBUG", message, fields);
      if (options.writeConsole) {
        console.debug(formatConsoleLog(message, fields));
      }
    },
    async info(message: string, fields?: LogFields): Promise<void> {
      if (!shouldLog("info", level)) {
        return;
      }

      await writeLogLine(path, "INFO", message, fields);
      if (options.writeConsole) {
        console.log(formatConsoleLog(message, fields));
      }
    },
    async error(message: string, fields?: LogFields, error?: unknown): Promise<void> {
      if (!shouldLog("error", level)) {
        return;
      }

      await writeLogLine(path, "ERROR", message, fields);
      if (error !== undefined) {
        await writeLogLine(path, "ERROR", formatError(error), fields);
      }

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
