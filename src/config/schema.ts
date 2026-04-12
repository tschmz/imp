import { z } from "zod";
import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import type { AppConfig, EndpointConfig } from "./types.js";
import { getTransport, listTransportTypes } from "../transports/registry.js";

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

const agentPromptConfigSchema = z.object({
  base: promptSourceSchema.optional(),
  instructions: promptSourceSchema.array().optional(),
  references: promptSourceSchema.array().optional(),
});

const agentWorkspaceConfigSchema = z.object({
  cwd: z.string().min(1).optional(),
  shellPath: z.string().min(1).array().optional(),
});

const agentSkillsConfigSchema = z.object({
  paths: z.string().min(1).array(),
});

const mcpServerIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "MCP server ids may only contain letters, numbers, hyphens, and underscores.",
  );

const mcpServerConfigSchema = z.object({
  id: mcpServerIdSchema,
  command: z.string().min(1),
  args: z.string().min(1).array().optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
});

const agentToolsConfigSchema = z
  .union([
    z.string().min(1).array(),
    z.object({
      builtIn: z.string().min(1).array().optional(),
      mcp: z
        .object({
          servers: mcpServerConfigSchema.array().min(1),
        })
        .optional(),
    }),
  ])
  .superRefine((tools, ctx) => {
    if (Array.isArray(tools)) {
      return;
    }

    const serverIds = new Set<string>();
    for (const [index, server] of (tools.mcp?.servers ?? []).entries()) {
      if (serverIds.has(server.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mcp", "servers", index, "id"],
          message: `Duplicate MCP server id "${server.id}". MCP server ids must be unique per agent.`,
        });
        continue;
      }

      serverIds.add(server.id);
    }
  });

const agentConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    prompt: agentPromptConfigSchema.optional(),
    model: modelConfigSchema.optional(),
    authFile: z.string().min(1).optional(),
    inference: inferenceSettingsSchema.optional(),
    workspace: agentWorkspaceConfigSchema.optional(),
    skills: agentSkillsConfigSchema.optional(),
    tools: agentToolsConfigSchema.optional(),
  })
  .superRefine((agent, ctx) => {
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

const transportSchemas = listTransportTypes().map((type) => {
  const entry = getTransport(type);
  if (!entry) {
    throw new Error(`Unsupported endpoint transport: ${type}`);
  }

  return entry.configSchema as z.ZodType<EndpointConfig>;
});

if (transportSchemas.length === 0) {
  throw new Error("No endpoint transports registered.");
}

const endpointConfigSchema =
  transportSchemas.length === 1
    ? transportSchemas[0]
    : (z.discriminatedUnion("type", [
        transportSchemas[0] as z.core.$ZodTypeDiscriminable,
        ...(transportSchemas.slice(1) as z.core.$ZodTypeDiscriminable[]),
      ]) as unknown as z.ZodType<EndpointConfig>);

export const appConfigSchema: z.ZodType<AppConfig> = z.object({
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
  endpoints: endpointConfigSchema.array(),
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

  const endpointIds = new Set<string>();
  for (const [index, endpoint] of config.endpoints.entries()) {
    if (endpointIds.has(endpoint.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endpoints", index, "id"],
        message: `Duplicate endpoint id "${endpoint.id}". Endpoint ids must be unique.`,
      });
      continue;
    }

    endpointIds.add(endpoint.id);
  }

  if (!knownAgentIds.has(config.defaults.agentId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaults", "agentId"],
      message: `Unknown default agent id "${config.defaults.agentId}". Expected one of: ${formatKnownIds(knownAgentIds)}.`,
    });
  }

  for (const [index, endpoint] of config.endpoints.entries()) {
    const defaultAgentId = endpoint.routing?.defaultAgentId;
    if (!defaultAgentId || knownAgentIds.has(defaultAgentId)) {
      continue;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoints", index, "routing", "defaultAgentId"],
      message: `Unknown default agent id "${defaultAgentId}" for endpoint "${endpoint.id}". Expected one of: ${formatKnownIds(knownAgentIds)}.`,
    });
  }
});

function formatKnownIds(ids: Set<string>): string {
  return [...ids].sort().map((id) => `"${id}"`).join(", ");
}
