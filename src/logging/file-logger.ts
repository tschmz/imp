import { appendFile } from "node:fs/promises";

export interface FileLogger {
  info(message: string): Promise<void>;
  error(message: string, error?: unknown): Promise<void>;
}

export function createFileLogger(path: string): FileLogger {
  return {
    async info(message: string): Promise<void> {
      await writeLogLine(path, "INFO", message);
      console.log(message);
    },
    async error(message: string, error?: unknown): Promise<void> {
      await writeLogLine(path, "ERROR", message);
      if (error !== undefined) {
        await writeLogLine(path, "ERROR", formatError(error));
      }

      console.error(message);
      if (error !== undefined) {
        console.error(error);
      }
    },
  };
}

async function writeLogLine(path: string, level: string, message: string): Promise<void> {
  await appendFile(path, `[${new Date().toISOString()}] ${level} ${message}\n`, "utf8");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}
