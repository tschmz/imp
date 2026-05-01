import { join } from "node:path";
import { z } from "zod";
import type { FileEndpointConfig } from "../../config/types.js";
import type { ActiveEndpointRuntimeConfig, FileEndpointRuntimeConfig } from "../../daemon/types.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportContext } from "../types.js";
import { createFileTransport } from "./file-transport.js";

const defaultPollIntervalMs = 1000;
const defaultMaxEventBytes = 256 * 1024;

const endpointIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Endpoint ids may only contain letters, numbers, hyphens, and underscores.",
  );

const pluginIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Plugin ids may only contain letters, numbers, hyphens, and underscores.",
  );

const routingSchema = z
  .object({
    defaultAgentId: z.string().min(1).optional(),
  })
  .optional();

const replyChannelKindSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Reply channel kinds may only contain letters, numbers, hyphens, and underscores.",
  );

export const fileTransportConfigSchema = z.object({
  id: endpointIdSchema,
  type: z.literal("file"),
  enabled: z.boolean(),
  pluginId: pluginIdSchema,
  routing: routingSchema,
  ingress: z
    .object({
      pollIntervalMs: z.number().int().positive().optional(),
      maxEventBytes: z.number().int().positive().optional(),
    })
    .optional(),
  response: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("none"),
    }),
    z.object({
      type: z.literal("endpoint"),
      endpointId: endpointIdSchema,
      target: z.object({
        conversationId: z.string().min(1),
        userId: z.string().min(1).optional(),
      }),
    }),
    z.object({
      type: z.literal("outbox"),
      replyChannel: z.object({
        kind: replyChannelKindSchema,
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
  ]),
}).strict();

export function normalizeFileRuntimeConfig(
  endpoint: FileEndpointConfig,
  options: {
    dataRoot: string;
    defaultAgentId: string;
  },
): ActiveEndpointRuntimeConfig {
  const logsDir = join(options.dataRoot, "logs");
  const runtimeDir = join(options.dataRoot, "runtime", "endpoints");
  const pluginRoot = join(options.dataRoot, "runtime", "plugins", endpoint.pluginId, "endpoints", endpoint.id);

  return {
    id: endpoint.id,
    type: endpoint.type,
    pluginId: endpoint.pluginId,
    ingress: {
      pollIntervalMs: endpoint.ingress?.pollIntervalMs ?? defaultPollIntervalMs,
      maxEventBytes: endpoint.ingress?.maxEventBytes ?? defaultMaxEventBytes,
    },
    response: endpoint.response,
    defaultAgentId: endpoint.routing?.defaultAgentId ?? options.defaultAgentId,
    paths: {
      dataRoot: options.dataRoot,
      sessionsDir: join(options.dataRoot, "sessions"),
      bindingsDir: join(options.dataRoot, "bindings"),
      logsDir,
      logFilePath: join(logsDir, "endpoints.log"),
      runtimeDir,
      runtimeStatePath: join(runtimeDir, `${endpoint.id}.json`),
      file: {
        rootDir: pluginRoot,
        inboxDir: join(pluginRoot, "inbox"),
        processingDir: join(pluginRoot, "processing"),
        processedDir: join(pluginRoot, "processed"),
        failedDir: join(pluginRoot, "failed"),
        outboxDir: join(pluginRoot, "outbox"),
      },
    },
  };
}

export function createFileTransportFromRuntimeConfig(
  config: ActiveEndpointRuntimeConfig,
  logger: Logger,
  context: TransportContext,
): Transport {
  if (config.type !== "file") {
    throw new Error(`Expected file endpoint runtime config, got "${config.type}".`);
  }

  return createFileTransport(config as FileEndpointRuntimeConfig & ActiveEndpointRuntimeConfig, logger, context);
}
