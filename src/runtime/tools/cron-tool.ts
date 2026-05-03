import type { AgentDefinition } from "../../domain/agent.js";
import type { ToolDefinition } from "../../tools/types.js";
import { deleteAgentCronJob, getAgentCronPath, readAgentCronFile, upsertAgentCronJob } from "../../cron/cron-md.js";
import type { CronJobDefinition } from "../../cron/types.js";
import { createUserVisibleToolError } from "../user-visible-tool-error.js";

export function createCronTool(agent?: AgentDefinition): ToolDefinition[] {
  if (!agent?.home) {
    return [];
  }

  const parameters = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "upsert", "delete"] },
      job: {
        type: "object",
        description: "Required for upsert. Cron job config plus instruction text.",
        additionalProperties: true,
      },
      id: { type: "string", description: "Required for delete." },
    },
    required: ["action"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return [{
    name: "cron",
    label: "cron",
    description:
      "List, create, update, or delete scheduled Imp jobs for this agent. Jobs are stored in agent-home/cron.md and hot-reloaded by the daemon.",
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const input = parseCronToolParams(params);
      if (input.action === "list") {
        const jobs = await readAgentCronFile(agent);
        return {
          content: [{ type: "text", text: jobs.length > 0 ? JSON.stringify(jobs, null, 2) : "No cron jobs configured." }],
          details: { path: getAgentCronPath(agent.home!), jobs },
        };
      }

      if (input.action === "delete") {
        const deleted = await deleteAgentCronJob(agent.home!, input.id);
        return {
          content: [{ type: "text", text: deleted ? `Deleted cron job ${input.id}.` : `Cron job ${input.id} was not found.` }],
          details: { path: getAgentCronPath(agent.home!), deleted },
        };
      }

      await upsertAgentCronJob(agent.home!, input.job);
      return {
        content: [{ type: "text", text: `Saved cron job ${input.job.id} to ${getAgentCronPath(agent.home!)}.` }],
        details: { path: getAgentCronPath(agent.home!), job: input.job },
      };
    },
  }];
}

type CronToolInput =
  | { action: "list" }
  | { action: "delete"; id: string }
  | { action: "upsert"; job: CronJobDefinition };

function parseCronToolParams(params: unknown): CronToolInput {
  if (!isRecord(params)) {
    throw createUserVisibleToolError("tool_command_execution", "cron requires an object parameter.");
  }
  if (params.action === "list") {
    return { action: "list" };
  }
  if (params.action === "delete") {
    if (typeof params.id !== "string" || params.id.trim().length === 0) {
      throw createUserVisibleToolError("tool_command_execution", "cron delete requires an id string.");
    }
    return { action: "delete", id: params.id.trim() };
  }
  if (params.action === "upsert") {
    return { action: "upsert", job: parseJob(params.job) };
  }
  throw createUserVisibleToolError("tool_command_execution", "cron action must be list, upsert, or delete.");
}

function parseJob(value: unknown): CronJobDefinition {
  if (!isRecord(value)) {
    throw createUserVisibleToolError("tool_command_execution", "cron upsert requires a job object.");
  }
  const id = requireString(value.id, "job.id");
  const schedule = requireString(value.schedule, "job.schedule");
  const instruction = requireString(value.instruction, "job.instruction");
  const reply = parseReply(value.reply);
  const session = parseSession(value.session, id);
  return {
    id,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    schedule,
    ...(typeof value.timezone === "string" && value.timezone.trim() ? { timezone: value.timezone.trim() } : {}),
    reply,
    session,
    instruction,
  };
}

function parseReply(value: unknown): CronJobDefinition["reply"] {
  if (!isRecord(value)) {
    throw createUserVisibleToolError("tool_command_execution", "job.reply must be an object.");
  }
  if (value.type === "none") {
    return { type: "none" };
  }
  if (value.type === "endpoint") {
    const target = isRecord(value.target) ? value.target : undefined;
    if (!target) {
      throw createUserVisibleToolError("tool_command_execution", "endpoint reply requires target.");
    }
    return {
      type: "endpoint",
      endpointId: requireString(value.endpointId, "job.reply.endpointId"),
      target: {
        conversationId: requireString(target.conversationId, "job.reply.target.conversationId"),
        ...(typeof target.userId === "string" && target.userId.trim() ? { userId: target.userId.trim() } : {}),
      },
    };
  }
  throw createUserVisibleToolError("tool_command_execution", "job.reply.type must be none or endpoint.");
}

function parseSession(value: unknown, fallbackId: string): CronJobDefinition["session"] {
  if (value === undefined) {
    return { mode: "detached", id: fallbackId };
  }
  if (!isRecord(value) || value.mode !== "detached") {
    throw createUserVisibleToolError("tool_command_execution", "job.session.mode must be detached.");
  }
  return {
    mode: "detached",
    id: requireString(value.id, "job.session.id"),
    ...(typeof value.title === "string" && value.title.trim() ? { title: value.title.trim() } : {}),
    ...(typeof value.kind === "string" && value.kind.trim() ? { kind: value.kind.trim() } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createUserVisibleToolError("tool_command_execution", `cron ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
