import { z } from "zod";

const loggingLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const modelConfigSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
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
    model: modelConfigSchema.optional(),
    systemPrompt: z.string().min(1).optional(),
  }),
  bots: telegramBotSchema.array().min(1),
});
