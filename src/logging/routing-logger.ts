import type { AgentLoggers } from "./agent-loggers.js";
import type { LogFields, Logger } from "./types.js";

export function createRoutingLogger(endpointLogger: Logger, agentLoggers: AgentLoggers): Logger {
  return {
    async debug(message, fields) {
      await selectLogger(endpointLogger, agentLoggers, message, fields).debug(message, fields);
    },
    async info(message, fields) {
      await selectLogger(endpointLogger, agentLoggers, message, fields).info(message, fields);
    },
    async error(message, fields, error) {
      await selectLogger(endpointLogger, agentLoggers, message, fields).error(message, fields, error);
    },
    async close() {
      await Promise.all([endpointLogger.close?.(), agentLoggers.close?.()]);
    },
  };
}

function selectLogger(
  endpointLogger: Logger,
  agentLoggers: AgentLoggers,
  message: string,
  fields?: LogFields,
): Logger {
  if (fields?.agentId && isAgentScopedLog(message, fields)) {
    return agentLoggers.forAgent(fields.agentId);
  }

  return endpointLogger;
}

function isAgentScopedLog(message: string, fields: LogFields): boolean {
  return (
    message === "agent-engine.pipeline" ||
    message === "agent engine run failed" ||
    message === "resolved system prompt sources" ||
    message === "auto-discovered skills override earlier agent skills for turn" ||
    message === "resolved effective agent skills for turn" ||
    message === "failed to resolve effective agent skills for turn; continuing without skills" ||
    fields.globalSkillsPath !== undefined ||
    fields.agentHomeSkillsPath !== undefined ||
    fields.workspaceSkillsPath !== undefined
  );
}
