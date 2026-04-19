import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createFileLogger, rotateLogFileOnStartup } from "./file-logger.js";
import type { Logger, LogLevel } from "./types.js";

export interface AgentLoggers {
  forAgent(agentId: string): Logger;
}

export type LoggerFactory = (path: string, level: LogLevel) => Logger;

export function createAgentLoggers(
  dataRoot: string,
  level: LogLevel,
  createLogger: LoggerFactory = createFileLogger,
): AgentLoggers {
  const loggers = new Map<string, Logger>();

  return {
    forAgent(agentId) {
      const existing = loggers.get(agentId);
      if (existing) {
        return existing;
      }

      const logger = createLogger(getAgentLogFilePath(dataRoot, agentId), level);
      loggers.set(agentId, logger);
      return logger;
    },
  };
}

export async function prepareAgentLogFiles(dataRoots: Iterable<string>, agentIds: Iterable<string>): Promise<void> {
  const uniqueDataRoots = [...new Set(dataRoots)];
  const uniqueAgentIds = [...new Set(agentIds)];

  await Promise.all(
    uniqueDataRoots.flatMap((dataRoot) =>
      uniqueAgentIds.map(async (agentId) => {
        await mkdir(getAgentLogsDir(dataRoot), { recursive: true });
        await rotateLogFileOnStartup(getAgentLogFilePath(dataRoot, agentId));
      }),
    ),
  );
}

export function getAgentLogFilePath(dataRoot: string, agentId: string): string {
  return join(getAgentLogsDir(dataRoot), `${sanitizeAgentLogFileName(agentId)}.log`);
}

function getAgentLogsDir(dataRoot: string): string {
  return join(dataRoot, "logs", "agents");
}

function sanitizeAgentLogFileName(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9._-]/g, "_") || "unknown";
}
