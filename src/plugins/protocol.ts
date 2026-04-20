import { z } from "zod";

export const pluginIdentifierSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Identifiers may only contain letters, numbers, hyphens, and underscores.",
  );

export const pluginReplyChannelKindSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Reply channel kinds may only contain letters, numbers, hyphens, and underscores.",
  );

export const pluginResponseRoutingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("none"),
  }),
  z.object({
    type: z.literal("endpoint"),
    endpointId: pluginIdentifierSchema,
    target: z.object({
      conversationId: z.string().min(1),
      userId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    type: z.literal("outbox"),
    replyChannel: z.object({
      kind: pluginReplyChannelKindSchema,
    }),
    priority: z.enum(["low", "normal", "high"]).optional(),
    ttlMs: z.number().int().positive().optional(),
    speech: z
      .object({
        enabled: z.boolean().optional(),
        language: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        voice: z.string().min(1).optional(),
        instructions: z.string().min(1).optional(),
      })
      .optional(),
  }),
]);

export const pluginEventSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  id: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  session: z
    .object({
      mode: z.literal("detached"),
      id: z.string().min(1),
      agentId: z.string().min(1).optional(),
      kind: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  userId: z.string().min(1).optional(),
  text: z.string().min(1),
  receivedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  response: z
    .object({
      type: z.literal("none"),
    })
    .optional(),
});

export const pluginOutboxMessageSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  eventId: z.string().min(1),
  correlationId: z.string().min(1),
  conversationId: z.string().min(1),
  userId: z.string().min(1),
  replyChannel: z.object({
    kind: pluginReplyChannelKindSchema,
  }),
  priority: z.enum(["low", "normal", "high"]),
  ttlMs: z.number().int().positive().optional(),
  speech: z
    .object({
      enabled: z.boolean().optional(),
      language: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      voice: z.string().min(1).optional(),
      instructions: z.string().min(1).optional(),
    })
    .optional(),
  text: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const pluginErrorRecordSchema = z.object({
  fileName: z.string().min(1),
  endpointId: z.string().min(1),
  pluginId: z.string().min(1),
  failedAt: z.string().datetime(),
  errorType: z.string().min(1),
  message: z.string(),
});

export type PluginEvent = z.infer<typeof pluginEventSchema>;
export type PluginOutboxMessage = z.infer<typeof pluginOutboxMessageSchema>;
export type PluginResponseRouting = z.infer<typeof pluginResponseRoutingSchema>;
export type PluginErrorRecord = z.infer<typeof pluginErrorRecordSchema>;
