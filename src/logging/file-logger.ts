import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createStream, type RotatingFileStream } from "rotating-file-stream";
import type { LogErrorFields, LogFields, Logger, LogLevel, LogRotationSize } from "./types.js";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const DEFAULT_LOG_ROTATION_SIZE: LogRotationSize = "5M";

export interface FileLoggerOptions {
  rotationSize?: LogRotationSize;
}

export function createFileLogger(path: string, level: LogLevel = "info", options: FileLoggerOptions = {}): Logger {
  return createFileLoggerWithOptions(path, level, { ...options, writeConsole: true });
}

export function createFileOnlyLogger(path: string, level: LogLevel = "info", options: FileLoggerOptions = {}): Logger {
  return createFileLoggerWithOptions(path, level, { ...options, writeConsole: false });
}

function createFileLoggerWithOptions(
  path: string,
  level: LogLevel,
  options: FileLoggerOptions & { writeConsole: boolean },
): Logger {
  const writer = createRotatingLogWriter(path, options.rotationSize ?? DEFAULT_LOG_ROTATION_SIZE);

  return {
    async debug(message: string, fields?: LogFields): Promise<void> {
      if (!shouldLog("debug", level)) {
        return;
      }

      await writeLogLine(writer, "debug", message, fields);
      if (options.writeConsole) {
        console.debug(formatConsoleLog(message, fields));
      }
    },
    async info(message: string, fields?: LogFields): Promise<void> {
      if (!shouldLog("info", level)) {
        return;
      }

      await writeLogLine(writer, "info", message, fields);
      if (options.writeConsole) {
        console.log(formatConsoleLog(message, fields));
      }
    },
    async error(message: string, fields?: LogFields, error?: unknown): Promise<void> {
      if (!shouldLog("error", level)) {
        return;
      }

      await writeLogLine(writer, "error", message, fields, error);

      if (options.writeConsole) {
        console.error(formatConsoleLog(message, fields));
        if (error !== undefined) {
          console.error(error);
        }
      }
    },
    async close(): Promise<void> {
      await writer.close();
    },
  };
}

export async function prepareLogFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
}

interface RotatingLogWriter {
  write(line: string): Promise<void>;
  close(): Promise<void>;
}

interface SharedRotatingLogWriter extends RotatingLogWriter {
  key: string;
  references: number;
}

const rotatingLogWriters = new Map<string, SharedRotatingLogWriter>();

function createRotatingLogWriter(path: string, rotationSize: LogRotationSize): RotatingLogWriter {
  const key = `${path}\0${rotationSize}`;
  const existing = rotatingLogWriters.get(key);
  if (existing) {
    existing.references += 1;
    return createWriterReference(existing);
  }

  let streamError: Error | undefined;
  const stream = createStream(createLogFileNameGenerator(path), {
    path: dirname(path),
    size: rotationSize,
  });

  stream.on("error", (error) => {
    streamError = error;
  });

  const writer: SharedRotatingLogWriter = {
    key,
    references: 1,
    async write(line: string): Promise<void> {
      if (streamError) {
        throw streamError;
      }

      await writeToStream(stream, line);

      if (streamError) {
        throw streamError;
      }
    },
    async close(): Promise<void> {
      this.references -= 1;
      if (this.references > 0) {
        return;
      }

      rotatingLogWriters.delete(this.key);
      await closeStream(stream);
    },
  };
  rotatingLogWriters.set(key, writer);
  return createWriterReference(writer);
}

function createWriterReference(writer: SharedRotatingLogWriter): RotatingLogWriter {
  let closed = false;
  return {
    async write(line: string): Promise<void> {
      if (closed) {
        throw new Error("Cannot write to a closed logger.");
      }

      await writer.write(line);
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      await writer.close();
    },
  };
}

function createLogFileNameGenerator(path: string): (time: number | Date, index?: number) => string {
  const fileName = basename(path);
  return (time, index) => {
    if (!time) {
      return fileName;
    }

    return `${fileName}.${index ?? 1}`;
  };
}

async function writeToStream(stream: RotatingFileStream, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(line, "utf8", (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeStream(stream: RotatingFileStream): Promise<void> {
  if (stream.closed || stream.destroyed) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function shouldLog(entryLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[entryLevel] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

async function writeLogLine(
  writer: RotatingLogWriter,
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

  await writer.write(`${JSON.stringify(payload)}\n`);
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
