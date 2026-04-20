import { z } from "zod";
import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import type { AgentConfig, AgentToolsConfig, AppConfig, EndpointConfig, FileEndpointConfig } from "./types.js";
import { getTransport, listTransportTypes } from "../transports/registry.js";

type RefinementContext<T> = z.core.$RefinementCtx<T>;

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
  inheritEnv: z.string().min(1).array().optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
});

const toolsConfigSchema = z.object({
  mcp: z
    .object({
      inheritEnv: z.string().min(1).array().optional(),
      servers: mcpServerConfigSchema.array().min(1),
    })
    .optional(),
});

const phoneContactIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Phone contact ids may only contain letters, numbers, hyphens, and underscores.",
  );

const phoneCallConfigSchema = z.object({
  contacts: z
    .object({
      id: phoneContactIdSchema,
      name: z.string().min(1),
      uri: z.string().min(1),
      comment: z.string().min(1).optional(),
    })
    .array()
    .min(1),
  command: z.string().min(1).optional(),
  args: z.string().array().optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  controlDir: z.string().min(1).optional(),
});

const agentToolsConfigSchema = z
  .union([
    z.string().min(1).array(),
    z.object({
      builtIn: z.string().min(1).array().optional(),
      mcp: z
        .object({
          servers: mcpServerIdSchema.array().min(1),
        })
        .optional(),
      phone: phoneCallConfigSchema.optional(),
    }),
  ])
  .superRefine(validateAgentToolsConfig);

const agentConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    prompt: agentPromptConfigSchema.optional(),
    model: modelConfigSchema.optional(),
    home: z.string().min(1).optional(),
    authFile: z.string().min(1).optional(),
    inference: inferenceSettingsSchema.optional(),
    workspace: agentWorkspaceConfigSchema.optional(),
    skills: agentSkillsConfigSchema.optional(),
    tools: agentToolsConfigSchema.optional(),
  })
  .superRefine(validateAgentConfig);

const pluginIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Plugin ids may only contain letters, numbers, hyphens, and underscores.",
  );

const pluginConfigSchema = z.object({
  id: pluginIdSchema,
  enabled: z.boolean(),
  package: z
    .object({
      path: z.string().min(1),
      source: z
        .object({
          version: z.string().min(1).optional(),
          manifestHash: z.string().min(1).optional(),
        })
        .optional(),
      command: z.string().min(1).optional(),
      args: z.string().min(1).array().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
}).strict();

const endpointConfigSchema = createEndpointConfigSchema();

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
  tools: toolsConfigSchema.optional(),
  agents: agentConfigSchema.array().min(1),
  plugins: pluginConfigSchema.array().optional(),
  endpoints: endpointConfigSchema.array(),
}).superRefine(validateAppConfig);

function createEndpointConfigSchema(): z.ZodType<EndpointConfig> {
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

  return transportSchemas.length === 1
    ? transportSchemas[0]!
    : (z.discriminatedUnion("type", [
        transportSchemas[0] as z.core.$ZodTypeDiscriminable,
        ...(transportSchemas.slice(1) as z.core.$ZodTypeDiscriminable[]),
      ]) as unknown as z.ZodType<EndpointConfig>);
}

function validateAgentToolsConfig(
  tools: AgentToolsConfig,
  ctx: RefinementContext<AgentToolsConfig>,
): void {
  if (Array.isArray(tools)) {
    return;
  }

  const contactIds = new Set<string>();
  for (const [index, contact] of (tools.phone?.contacts ?? []).entries()) {
    if (contactIds.has(contact.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone", "contacts", index, "id"],
        message: `Duplicate phone contact id "${contact.id}". Phone contact ids must be unique per agent.`,
      });
      continue;
    }

    contactIds.add(contact.id);
  }

  const serverRefs = new Set<string>();
  for (const [index, serverId] of (tools.mcp?.servers ?? []).entries()) {
    if (serverRefs.has(serverId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mcp", "servers", index],
        message: `Duplicate MCP server reference "${serverId}". MCP server references must be unique per agent.`,
      });
      continue;
    }

    serverRefs.add(serverId);
  }
}

function validateAgentConfig(agent: AgentConfig, ctx: RefinementContext<AgentConfig>): void {
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
}

function validateAppConfig(config: AppConfig, ctx: RefinementContext<AppConfig>): void {
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
  const enabledEndpointIds = new Set<string>();
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
    if (endpoint.enabled) {
      enabledEndpointIds.add(endpoint.id);
    }
  }

  const mcpServerIds = new Set<string>();
  for (const [index, server] of (config.tools?.mcp?.servers ?? []).entries()) {
    if (mcpServerIds.has(server.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tools", "mcp", "servers", index, "id"],
        message: `Duplicate MCP server id "${server.id}". MCP server ids must be unique.`,
      });
      continue;
    }

    mcpServerIds.add(server.id);
  }

  const pluginIds = new Set<string>();
  const enabledPluginIds = new Set<string>();
  for (const [index, plugin] of (config.plugins ?? []).entries()) {
    if (pluginIds.has(plugin.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plugins", index, "id"],
        message: `Duplicate plugin id "${plugin.id}". Plugin ids must be unique.`,
      });
      continue;
    }

    pluginIds.add(plugin.id);
    if (plugin.enabled) {
      enabledPluginIds.add(plugin.id);
    }
  }

  validateDefaultAgent(config, knownAgentIds, ctx);
  validateAgentMcpServerReferences(config, mcpServerIds, ctx);
  validateEndpointDefaultAgents(config, knownAgentIds, ctx);
  validateFileEndpoints(config, endpointIds, enabledEndpointIds, pluginIds, enabledPluginIds, ctx);
}

function validateAgentMcpServerReferences(
  config: AppConfig,
  mcpServerIds: Set<string>,
  ctx: RefinementContext<AppConfig>,
): void {
  for (const [agentIndex, agent] of config.agents.entries()) {
    if (Array.isArray(agent.tools)) {
      continue;
    }

    for (const [serverIndex, serverId] of (agent.tools?.mcp?.servers ?? []).entries()) {
      if (mcpServerIds.has(serverId)) {
        continue;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents", agentIndex, "tools", "mcp", "servers", serverIndex],
        message: `Unknown MCP server id "${serverId}" for agent "${agent.id}".`,
      });
    }
  }
}

function validateDefaultAgent(
  config: AppConfig,
  knownAgentIds: Set<string>,
  ctx: RefinementContext<AppConfig>,
): void {
  if (knownAgentIds.has(config.defaults.agentId)) {
    return;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["defaults", "agentId"],
    message: `Unknown default agent id "${config.defaults.agentId}". Expected one of: ${formatKnownIds(knownAgentIds)}.`,
  });
}

function validateEndpointDefaultAgents(
  config: AppConfig,
  knownAgentIds: Set<string>,
  ctx: RefinementContext<AppConfig>,
): void {
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
}

function validateFileEndpoints(
  config: AppConfig,
  endpointIds: Set<string>,
  enabledEndpointIds: Set<string>,
  pluginIds: Set<string>,
  enabledPluginIds: Set<string>,
  ctx: RefinementContext<AppConfig>,
): void {
  for (const [index, endpoint] of config.endpoints.entries()) {
    if (endpoint.type !== "file") {
      continue;
    }

    validateFileEndpointPluginReference(endpoint, index, pluginIds, enabledPluginIds, ctx);

    if (endpoint.response.type !== "endpoint") {
      continue;
    }

    validateFileEndpointResponseTarget(endpoint, index, endpointIds, enabledEndpointIds, ctx);
  }
}

function validateFileEndpointPluginReference(
  endpoint: FileEndpointConfig,
  index: number,
  pluginIds: Set<string>,
  enabledPluginIds: Set<string>,
  ctx: RefinementContext<AppConfig>,
): void {
  if (!pluginIds.has(endpoint.pluginId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoints", index, "pluginId"],
      message: `Unknown plugin id "${endpoint.pluginId}" for endpoint "${endpoint.id}".`,
    });
  }

  if (endpoint.enabled && !enabledPluginIds.has(endpoint.pluginId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoints", index, "pluginId"],
      message: `Plugin id "${endpoint.pluginId}" for endpoint "${endpoint.id}" must be enabled.`,
    });
  }
}

function validateFileEndpointResponseTarget(
  endpoint: FileEndpointConfig,
  index: number,
  endpointIds: Set<string>,
  enabledEndpointIds: Set<string>,
  ctx: RefinementContext<AppConfig>,
): void {
  if (endpoint.response.type !== "endpoint") {
    return;
  }

  if (endpoint.response.endpointId === endpoint.id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoints", index, "response", "endpointId"],
      message: "File endpoint responses must target a different endpoint.",
    });
  }

  if (!endpointIds.has(endpoint.response.endpointId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoints", index, "response", "endpointId"],
      message: `Unknown response endpoint id "${endpoint.response.endpointId}" for file endpoint "${endpoint.id}".`,
    });
  }

  if (endpointIds.has(endpoint.response.endpointId) && !enabledEndpointIds.has(endpoint.response.endpointId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoints", index, "response", "endpointId"],
      message: `Response endpoint "${endpoint.response.endpointId}" for file endpoint "${endpoint.id}" must be enabled.`,
    });
  }
}

function formatKnownIds(ids: Set<string>): string {
  return [...ids].sort().map((id) => `"${id}"`).join(", ");
}
