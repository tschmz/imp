import type { AgentDefinition } from "../../domain/agent.js";
import type { IncomingMessage } from "../../domain/message.js";
import type { ToolDefinition } from "../../tools/types.js";
import { deleteAgentCronJob, getAgentCronPath, readAgentCronFile, upsertAgentCronJob } from "../../cron/cron-md.js";
import type { CronJobDefinition } from "../../cron/types.js";
import { createUserVisibleToolError } from "../user-visible-tool-error.js";

export function createCronTool(agent?: AgentDefinition, currentMessage?: IncomingMessage): ToolDefinition[] {
  if (!agent?.home) {
    return [];
  }

  const parameters = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "upsert", "delete"] },
      job: {
        type: "object",
        description: "Required for upsert. Cron job config plus the scheduled user instruction. job.instruction, job.session.id, and job.session.title support prompt template variables. session.mode defaults to attached. Use {{runtime.now.date}} in session.id, for example report-{{runtime.now.date}}, to rotate into a new detached or activated session each day.",
        properties: {
          id: {
            type: "string",
            minLength: 1,
            description: "Stable cron job id. Used as the fallback session title when job.session.title is not set.",
          },
          enabled: {
            type: "boolean",
            description: "Whether the job should run. Defaults to true.",
          },
          schedule: {
            type: "string",
            minLength: 1,
            description: "Five-field cron schedule: minute hour day-of-month month day-of-week.",
          },
          timezone: {
            type: "string",
            minLength: 1,
            description: "Optional IANA timezone such as Europe/Berlin.",
          },
          reply: {
            type: "object",
            description: "Where to deliver the final response. Use {\"type\":\"current\"} to send the result back to the current inbound endpoint and conversation; the tool resolves it before saving cron.md. Use {\"type\":\"none\"} for no reply. Use {\"type\":\"endpoint\",\"endpointId\":\"trader-telegram\",\"target\":{\"conversationId\":\"<external conversation id>\"}} for an explicit endpoint reply.",
            properties: {
              type: { type: "string", enum: ["current", "none", "endpoint"] },
              endpointId: {
                type: "string",
                minLength: 1,
                description: "Exact endpoint id, for example trader-telegram. This is not the transport type.",
              },
              target: {
                type: "object",
                properties: {
                  conversationId: {
                    type: "string",
                    minLength: 1,
                    description: "External conversation id for the endpoint, for example the Telegram chat id.",
                  },
                  userId: { type: "string", minLength: 1 },
                },
                required: ["conversationId"],
                additionalProperties: false,
              },
            },
            required: ["type"],
            additionalProperties: false,
          },
          session: {
            type: "object",
            description: "Session settings. `attached` runs the job in the agent's current active session and is the default. `detached` keeps the cron session separate. `activate` creates/reuses the named session and makes it the current interactive session for the agent. Use title to set the visible session title. session.id and session.title can include template variables such as {{runtime.now.date}}.",
            properties: {
              mode: { type: "string", enum: ["attached", "detached", "activate"] },
              id: {
                type: "string",
                minLength: 1,
                description: "Session id for detached or activated cron sessions. Attached jobs use it only as the cron reference before the active session is resolved. Supports prompt template variables. Use report-{{runtime.now.date}} to rotate sessions daily.",
              },
              title: {
                type: "string",
                minLength: 1,
                description: "Optional visible title for the session created by this cron job. Supports template variables such as {{runtime.now.date}}.",
              },
              kind: { type: "string", minLength: 1 },
              metadata: { type: "object", additionalProperties: true },
            },
            additionalProperties: false,
          },
          instruction: {
            type: "string",
            minLength: 1,
            description: "Scheduled user instruction sent when the job fires. Write only the task-specific request the future agent should execute, plus any runtime context needed for that run. Do not copy or restate the agent's system prompt, persona, standing operating rules, tool policies, or reply-routing instructions; those are already applied at runtime. Good prompts describe the concrete recurring task, expected output, relevant scope or sources, and any date/time variables such as {{runtime.now.date}}.",
          },
        },
        required: ["id", "schedule", "reply", "instruction"],
        additionalProperties: false,
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
      "List, create, update, or delete scheduled Imp jobs for this agent. Jobs are stored in agent-home/cron.md and hot-reloaded by the daemon. A cron instruction is the future scheduled user message, not a replacement system prompt, so keep it task-specific and do not duplicate the agent's permanent instructions. Cron sessions default to attached, which runs in the agent's current active session.",
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const input = parseCronToolParams(params, currentMessage);
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

function parseCronToolParams(params: unknown, currentMessage?: IncomingMessage): CronToolInput {
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
    return { action: "upsert", job: parseJob(params.job, currentMessage) };
  }
  throw createUserVisibleToolError("tool_command_execution", "cron action must be list, upsert, or delete.");
}

function parseJob(value: unknown, currentMessage?: IncomingMessage): CronJobDefinition {
  if (!isRecord(value)) {
    throw createUserVisibleToolError("tool_command_execution", "cron upsert requires a job object.");
  }
  const id = requireString(value.id, "job.id");
  const schedule = requireString(value.schedule, "job.schedule");
  const instruction = requireString(value.instruction, "job.instruction");
  const reply = parseReply(value.reply, currentMessage);
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

function parseReply(value: unknown, currentMessage?: IncomingMessage): CronJobDefinition["reply"] {
  if (!isRecord(value)) {
    throw createUserVisibleToolError("tool_command_execution", "job.reply must be an object.");
  }
  if (value.type === "none") {
    return { type: "none" };
  }
  if (value.type === "current") {
    if (!currentMessage || currentMessage.endpointId === "cron" || currentMessage.conversation.transport === "cron") {
      throw createUserVisibleToolError(
        "tool_command_execution",
        "job.reply.type current requires a current endpoint conversation. Use an explicit endpoint reply instead.",
      );
    }
    return {
      type: "endpoint",
      endpointId: requireString(currentMessage.endpointId, "current message endpointId"),
      target: {
        conversationId: requireString(currentMessage.conversation.externalId, "current message conversationId"),
        ...(currentMessage.userId.trim() ? { userId: currentMessage.userId.trim() } : {}),
      },
    };
  }
  if (value.type === "endpoint") {
    const target = isRecord(value.target) ? value.target : undefined;
    if (!target) {
      throw createUserVisibleToolError(
        "tool_command_execution",
        "endpoint reply requires target object with conversationId.",
      );
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
  throw createUserVisibleToolError("tool_command_execution", "job.reply.type must be current, none, or endpoint.");
}

function parseSession(value: unknown, fallbackId: string): CronJobDefinition["session"] {
  if (value === undefined) {
    return { mode: "attached", id: fallbackId };
  }
  if (!isRecord(value)) {
    throw createUserVisibleToolError("tool_command_execution", "job.session must be an object.");
  }
  const mode = value.mode ?? "attached";
  if (mode !== "attached" && mode !== "detached" && mode !== "activate") {
    throw createUserVisibleToolError("tool_command_execution", "job.session.mode must be attached, detached, or activate.");
  }
  return {
    mode,
    id: value.id === undefined ? fallbackId : requireString(value.id, "job.session.id"),
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
