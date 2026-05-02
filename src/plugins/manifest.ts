import { z } from "zod";
import type { AgentConfig, FileIngressConfig, FileResponseRoutingConfig } from "../config/types.js";
import { secretValueConfigSchema } from "../config/secret-value.js";
import { pluginIdentifierSchema, pluginResponseRoutingSchema } from "./protocol.js";

export const PLUGIN_MANIFEST_FILE = "plugin.json";
export const USER_PLUGIN_MANIFEST_FILE = "imp-plugin.json";
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
  mcpServers?: PluginMcpServerManifest[];
  skills?: PluginSkillManifest[];
  agents?: PluginAgentManifest[];
  tools?: PluginToolManifest[];
  runtime?: PluginRuntimeManifest;
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
  ingress?: FileIngressConfig;
  response: FileResponseRoutingConfig;
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

export interface PluginMcpServerManifest {
  id: string;
  description?: string;
  command: string;
  args?: string[];
  inheritEnv?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface PluginSkillManifest {
  path: string;
}

export type PluginAgentManifest = AgentConfig;

export interface PluginToolManifest {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  runner: PluginCommandToolRunnerManifest;
}

export interface PluginCommandToolRunnerManifest {
  type: "command";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface PluginRuntimeManifest {
  module: string;
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


const promptSourceSchema = z
  .object({
    text: z.string().min(1).optional(),
    file: z.string().min(1).optional(),
  })
  .superRefine((source, ctx) => {
    const hasText = typeof source.text === "string";
    const hasFile = typeof source.file === "string";

    if (hasText === hasFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify exactly one of text or file.",
      });
    }
  });

const pluginAgentSchema: z.ZodType<PluginAgentManifest> = z.object({
  id: pluginIdentifierSchema,
  name: z.string().min(1).optional(),
  prompt: z.object({
    base: promptSourceSchema.optional(),
    instructions: promptSourceSchema.array().optional(),
    references: promptSourceSchema.array().optional(),
  }).optional(),
  model: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    api: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    reasoning: z.boolean().optional(),
    input: z.enum(["text", "image"]).array().min(1).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    authFile: z.string().min(1).optional(),
    apiKey: secretValueConfigSchema.optional(),
    inference: z.object({
      maxOutputTokens: z.number().int().positive().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      request: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
  }).optional(),
  home: z.string().min(1).optional(),
  workspace: z.object({
    cwd: z.string().min(1).optional(),
    shellPath: z.string().min(1).array().optional(),
  }).optional(),
  skills: z.object({
    paths: z.string().min(1).array(),
  }).optional(),
  tools: z.union([
    z.string().min(1).array(),
    z.object({
      builtIn: z.string().min(1).array().optional(),
      mcp: z.object({ servers: z.string().min(1).array().min(1) }).optional(),
      agents: z
        .object({
          agentId: z.string().min(1),
          toolName: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
        })
        .strict()
        .array()
        .min(1)
        .optional(),
    }),
  ]).optional(),
}).strict();

const pluginToolSchema: z.ZodType<PluginToolManifest> = z.object({
  name: pluginIdentifierSchema,
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  runner: z.object({
    type: z.literal("command"),
    command: z.string().min(1),
    args: z.string().min(1).array().optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
}).strict();

export const pluginManifestSchema: z.ZodType<PluginManifest> = z.object({
  schemaVersion: z.literal(PLUGIN_MANIFEST_SCHEMA_VERSION),
  id: pluginIdentifierSchema,
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
      id: pluginIdentifierSchema,
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
      response: pluginResponseRoutingSchema,
    })
    .array()
    .optional(),
  services: z
    .object({
      id: pluginIdentifierSchema,
      description: z.string().min(1).optional(),
      autoStart: z.boolean().optional(),
      command: z.string().min(1),
      args: z.string().min(1).array().optional(),
      cwd: z.string().min(1).optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .array()
    .optional(),
  mcpServers: z
    .object({
      id: pluginIdentifierSchema,
      description: z.string().min(1).optional(),
      command: z.string().min(1),
      args: z.string().min(1).array().optional(),
      inheritEnv: z.string().min(1).array().optional(),
      cwd: z.string().min(1).optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .array()
    .optional(),
  skills: z.object({ path: z.string().min(1) }).array().optional(),
  agents: pluginAgentSchema.array().optional(),
  tools: pluginToolSchema.array().optional(),
  runtime: z.object({ module: z.string().min(1) }).optional(),
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

  const skillPaths = new Set<string>();
  for (const [index, skill] of (manifest.skills ?? []).entries()) {
    if (skillPaths.has(skill.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["skills", index, "path"],
        message: `Duplicate skill path "${skill.path}". Skill paths must be unique per plugin.`,
      });
      continue;
    }

    skillPaths.add(skill.path);
  }

  const agentIds = new Set<string>();
  for (const [index, agent] of (manifest.agents ?? []).entries()) {
    if (agentIds.has(agent.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents", index, "id"],
        message: `Duplicate agent id "${agent.id}". Agent ids must be unique per plugin.`,
      });
      continue;
    }

    agentIds.add(agent.id);
  }

  const toolNames = new Set<string>();
  for (const [index, tool] of (manifest.tools ?? []).entries()) {
    if (toolNames.has(tool.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tools", index, "name"],
        message: `Duplicate tool name "${tool.name}". Tool names must be unique per plugin.`,
      });
      continue;
    }

    toolNames.add(tool.name);
  }

  const mcpServerIds = new Set<string>();
  for (const [index, server] of (manifest.mcpServers ?? []).entries()) {
    if (mcpServerIds.has(server.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mcpServers", index, "id"],
        message: `Duplicate MCP server id "${server.id}". MCP server ids must be unique per plugin.`,
      });
      continue;
    }

    mcpServerIds.add(server.id);
  }
});
