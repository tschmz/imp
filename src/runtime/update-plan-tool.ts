import type { ToolDefinition } from "../tools/types.js";
import { createUserVisibleToolError } from "./user-visible-tool-error.js";

const updatePlanStatuses = ["pending", "in_progress", "completed"] as const;

type UpdatePlanStatus = (typeof updatePlanStatuses)[number];

interface UpdatePlanItem {
  step: string;
  status: UpdatePlanStatus;
}

interface UpdatePlanDetails {
  explanation?: string;
  plan: UpdatePlanItem[];
}

export function createUpdatePlanTool(): ToolDefinition {
  const parameters = {
    type: "object",
    properties: {
      explanation: {
        type: "string",
        description: "Optional short explanation for why the plan changed.",
      },
      plan: {
        type: "array",
        description: "The complete current plan. Send the full list every time.",
        items: {
          type: "object",
          properties: {
            step: {
              type: "string",
              minLength: 1,
              description: "A concise task step.",
            },
            status: {
              type: "string",
              enum: updatePlanStatuses,
              description: "Current status for this step.",
            },
          },
          required: ["step", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["plan"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: "update_plan",
    label: "update_plan",
    description:
      "Update the visible task plan for multi-step work. Provide the full plan with at most one in_progress step.",
    parameters,
    async execute(_toolCallId, params) {
      const details = parseUpdatePlanParams(params);
      return {
        content: [{ type: "text", text: renderUpdatePlanResult(details) }],
        details,
      };
    },
  };
}

function parseUpdatePlanParams(params: unknown): UpdatePlanDetails {
  if (!isRecord(params)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "update_plan requires an object parameter with a plan array.",
    );
  }

  const explanation = parseExplanation(params.explanation);
  const plan = parsePlan(params.plan);
  const inProgressCount = plan.filter((item) => item.status === "in_progress").length;
  if (inProgressCount > 1) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "update_plan accepts at most one in_progress step.",
    );
  }

  return {
    ...(explanation ? { explanation } : {}),
    plan,
  };
}

function parseExplanation(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "update_plan explanation must be a string when provided.",
    );
  }

  const explanation = value.trim();
  return explanation.length > 0 ? explanation : undefined;
}

function parsePlan(value: unknown): UpdatePlanItem[] {
  if (!Array.isArray(value)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "update_plan requires a plan array.",
    );
  }

  return value.map((item, index) => parsePlanItem(item, index));
}

function parsePlanItem(value: unknown, index: number): UpdatePlanItem {
  if (!isRecord(value)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `update_plan plan item ${index + 1} must be an object.`,
    );
  }

  const step = parseStep(value.step, index);
  const status = parseStatus(value.status, index);
  return { step, status };
}

function parseStep(value: unknown, index: number): string {
  if (typeof value !== "string") {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `update_plan plan item ${index + 1} requires a step string.`,
    );
  }

  const step = value.trim();
  if (step.length === 0) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `update_plan plan item ${index + 1} requires a non-empty step.`,
    );
  }

  return step;
}

function parseStatus(value: unknown, index: number): UpdatePlanStatus {
  if (typeof value === "string" && isUpdatePlanStatus(value)) {
    return value;
  }

  throw createUserVisibleToolError(
    "tool_command_execution",
    `update_plan plan item ${index + 1} requires status pending, in_progress, or completed.`,
  );
}

function renderUpdatePlanResult(details: UpdatePlanDetails): string {
  const lines = ["Plan updated."];
  if (details.explanation) {
    lines.push(`Explanation: ${details.explanation}`);
  }
  for (const item of details.plan) {
    lines.push(`${item.status}: ${item.step}`);
  }
  return lines.join("\n");
}

function isUpdatePlanStatus(value: string): value is UpdatePlanStatus {
  return updatePlanStatuses.includes(value as UpdatePlanStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
