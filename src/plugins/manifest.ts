import { z } from "zod";
import type { PluginIngressConfig, PluginResponseRoutingConfig } from "../config/types.js";

export const PLUGIN_MANIFEST_FILE = "plugin.json";
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1;

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  capabilities?: PluginCapability[];
  endpoints?: PluginEndpointManifest[];
  services?: PluginServiceManifest[];
  setup?: PluginSetupManifest;
  init?: PluginInitManifest;
}

export type PluginCapability = "endpoint" | "service" | "audio" | "voice" | "wake-word" | "speech-output";

export interface PluginEndpointManifest {
  id: string;
  description?: string;
  routing?: {
    defaultAgentId?: string;
  };
  ingress?: PluginIngressConfig;
  response: PluginResponseRoutingConfig;
}

export interface PluginServiceManifest {
  id: string;
  description?: string;
  autoStart?: boolean;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface PluginInitManifest {
  configTemplate?: string;
  postInstallMessage?: string;
}

export interface PluginSetupManifest {
  python?: PluginPythonSetupManifest;
}

export interface PluginPythonSetupManifest {
  requirements?: string;
  python?: string;
  venv?: string;
}

const identifierSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Identifiers may only contain letters, numbers, hyphens, and underscores.",
  );

const replyChannelKindSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Reply channel kinds may only contain letters, numbers, hyphens, and underscores.",
  );

const responseRoutingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("none"),
  }),
  z.object({
    type: z.literal("endpoint"),
    endpointId: identifierSchema,
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
]);

export const pluginManifestSchema: z.ZodType<PluginManifest> = z.object({
  schemaVersion: z.literal(PLUGIN_MANIFEST_SCHEMA_VERSION),
  id: identifierSchema,
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1).optional(),
  homepage: z.string().min(1).optional(),
  capabilities: z
    .enum(["endpoint", "service", "audio", "voice", "wake-word", "speech-output"])
    .array()
    .optional(),
  endpoints: z
    .object({
      id: identifierSchema,
      description: z.string().min(1).optional(),
      routing: z
        .object({
          defaultAgentId: z.string().min(1).optional(),
        })
        .optional(),
      ingress: z
        .object({
          pollIntervalMs: z.number().int().positive().optional(),
          maxEventBytes: z.number().int().positive().optional(),
        })
        .optional(),
      response: responseRoutingSchema,
    })
    .array()
    .optional(),
  services: z
    .object({
      id: identifierSchema,
      description: z.string().min(1).optional(),
      autoStart: z.boolean().optional(),
      command: z.string().min(1),
      args: z.string().min(1).array().optional(),
      cwd: z.string().min(1).optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .array()
    .optional(),
  setup: z
    .object({
      python: z
        .object({
          requirements: z.string().min(1).optional(),
          python: z.string().min(1).optional(),
          venv: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
  init: z
    .object({
      configTemplate: z.string().min(1).optional(),
      postInstallMessage: z.string().min(1).optional(),
    })
    .optional(),
}).strict().superRefine((manifest, ctx) => {
  const endpointIds = new Set<string>();
  for (const [index, endpoint] of (manifest.endpoints ?? []).entries()) {
    if (endpointIds.has(endpoint.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endpoints", index, "id"],
        message: `Duplicate endpoint id "${endpoint.id}". Endpoint ids must be unique per plugin.`,
      });
      continue;
    }

    endpointIds.add(endpoint.id);
  }

  const serviceIds = new Set<string>();
  for (const [index, service] of (manifest.services ?? []).entries()) {
    if (serviceIds.has(service.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["services", index, "id"],
        message: `Duplicate service id "${service.id}". Service ids must be unique per plugin.`,
      });
      continue;
    }

    serviceIds.add(service.id);
  }
});
