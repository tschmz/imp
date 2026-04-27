import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createFileLogger, rotateLogFileOnStartup } from "./file-logger.js";
import type { LogFields, Logger, LogLevel } from "./types.js";

export interface AgentLoggers {
  forAgent(agentId: string): Logger;
}

export type LoggerFactory = (path: string, level: LogLevel) => Logger;

export function createAgentLoggers(
  dataRoot: string,
  level: LogLevel,
  createLogger: LoggerFactory = createFileLogger,
): AgentLoggers {
  const baseLogger = createLogger(getAgentLogFilePath(dataRoot), level);
  const loggers = new Map<string, Logger>();

  return {
    forAgent(agentId) {
      const existing = loggers.get(agentId);
      if (existing) {
        return existing;
      }

      const logger = createScopedLogger(baseLogger, { agentId });
      loggers.set(agentId, logger);
      return logger;
    },
  };
}

export async function prepareAgentLogFiles(dataRoots: Iterable<string>, agentIds: Iterable<string>): Promise<void> {
  void agentIds;
  const uniqueDataRoots = [...new Set(dataRoots)];

  await Promise.all(
    uniqueDataRoots.map(async (dataRoot) => {
      await mkdir(getLogsDir(dataRoot), { recursive: true });
      await rotateLogFileOnStartup(getAgentLogFilePath(dataRoot));
    }),
  );
}

export function getAgentLogFilePath(dataRoot: string): string {
  return join(getLogsDir(dataRoot), "agents.log");
}

export function createScopedLogger(logger: Logger, defaults: LogFields): Logger {
  return {
    async debug(message, fields) {
      await logger.debug(message, mergeLogFields(defaults, fields));
    },
    async info(message, fields) {
      await logger.info(message, mergeLogFields(defaults, fields));
    },
    async error(message, fields, error) {
      await logger.error(message, mergeLogFields(defaults, fields), error);
    },
  };
}

function mergeLogFields(defaults: LogFields, fields: LogFields | undefined): LogFields {
  return {
    ...defaults,
    ...(fields ?? {}),
  };
}

function getLogsDir(dataRoot: string): string {
  return join(dataRoot, "logs");
}
