import { z } from "zod";
import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";

const loggingLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const modelConfigSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});

const inferenceSettingsSchema = z.object({
  maxOutputTokens: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  request: z.record(z.string(), z.unknown()).optional(),
});

const agentContextConfigSchema = z.object({
  files: z.string().min(1).array().optional(),
  workingDirectory: z.string().min(1).optional(),
});

const agentConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    systemPrompt: z.string().min(1).optional(),
    systemPromptFile: z.string().min(1).optional(),
    model: modelConfigSchema.optional(),
    authFile: z.string().min(1).optional(),
    inference: inferenceSettingsSchema.optional(),
    context: agentContextConfigSchema.optional(),
    tools: z.string().min(1).array().optional(),
  })
  .superRefine((agent, ctx) => {
    if (agent.systemPrompt && agent.systemPromptFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["systemPromptFile"],
        message: "Specify either systemPrompt or systemPromptFile, not both.",
      });
    }

    if (!agent.systemPrompt && !agent.systemPromptFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["systemPrompt"],
        message: "Specify either systemPrompt or systemPromptFile.",
      });
    }

    if (!agent.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "Agent model is required.",
      });
    }

    if (!agent.authFile) {
      return;
    }

    const provider = agent.model?.provider;
    if (!provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authFile"],
        message: "`authFile` requires `model.provider` to be set to an OAuth-capable provider.",
      });
      return;
    }

    if (!getOAuthProvider(provider)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authFile"],
        message: `\`authFile\` is not supported for provider \`${provider}\`.`,
      });
    }
  });

const telegramBotSchema = z.object({
  id: z.string().min(1),
  type: z.literal("telegram"),
  enabled: z.boolean(),
  token: z.string().min(1),
  access: z.object({
    allowedUserIds: z
      .string()
      .array()
      .refine((values) => values.every((value) => /^\d+$/.test(value)), {
        message: "Telegram user IDs must contain digits only.",
      }),
  }),
  routing: z
    .object({
      defaultAgentId: z.string().min(1).optional(),
    })
    .optional(),
});

export const appConfigSchema = z.object({
  instance: z.object({
    name: z.string().min(1),
  }),
  paths: z.object({
    dataRoot: z.string().min(1),
  }),
  logging: z
    .object({
      level: loggingLevelSchema,
    })
    .optional(),
  defaults: z.object({
    agentId: z.string().min(1),
  }),
  agents: agentConfigSchema.array().min(1),
  bots: telegramBotSchema.array().min(1),
}).superRefine((config, ctx) => {
  const agentIds = new Set<string>();
  const knownAgentIds = new Set<string>();

  for (const [index, agent] of config.agents.entries()) {
    if (agentIds.has(agent.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents", index, "id"],
        message: `Duplicate agent id "${agent.id}". Agent ids must be unique.`,
      });
      continue;
    }

    agentIds.add(agent.id);
    knownAgentIds.add(agent.id);
  }

  const botIds = new Set<string>();
  for (const [index, bot] of config.bots.entries()) {
    if (botIds.has(bot.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bots", index, "id"],
        message: `Duplicate bot id "${bot.id}". Bot ids must be unique.`,
      });
      continue;
    }

    botIds.add(bot.id);
  }

  if (!knownAgentIds.has(config.defaults.agentId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaults", "agentId"],
      message: `Unknown default agent id "${config.defaults.agentId}". Expected one of: ${formatKnownIds(knownAgentIds)}.`,
    });
  }

  for (const [index, bot] of config.bots.entries()) {
    const defaultAgentId = bot.routing?.defaultAgentId;
    if (!defaultAgentId || knownAgentIds.has(defaultAgentId)) {
      continue;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bots", index, "routing", "defaultAgentId"],
      message: `Unknown default agent id "${defaultAgentId}" for bot "${bot.id}". Expected one of: ${formatKnownIds(knownAgentIds)}.`,
    });
  }
});

function formatKnownIds(ids: Set<string>): string {
  return [...ids].sort().map((id) => `"${id}"`).join(", ");
}
