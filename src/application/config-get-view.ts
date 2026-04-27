import { join } from "node:path";
import type {
  AgentConfig,
  AgentToolsConfig,
  AppConfig,
  CliEndpointConfig,
  EndpointConfig,
  FileEndpointConfig,
  TelegramEndpointConfig,
} from "../config/types.js";

const defaultTelegramDocumentMaxDownloadBytes = 20 * 1024 * 1024;
const defaultFilePollIntervalMs = 1000;
const defaultFileMaxEventBytes = 256 * 1024;

export function createConfigGetView(config: AppConfig): unknown {
  return {
    ...config,
    logging: {
      level: config.logging?.level ?? "info",
    },
    agents: config.agents.map((agent) =>
      materializeAgentDefaults(agent, config.paths.dataRoot, config.defaults.model),
    ),
    endpoints: config.endpoints.map((endpoint) => materializeEndpointDefaults(endpoint, config.defaults.agentId)),
  };
}

function materializeAgentDefaults(
  agent: AgentConfig,
  dataRoot: string,
  defaultModel: AppConfig["defaults"]["model"],
): Record<string, unknown> {
  return {
    ...agent,
    name: agent.name ?? agent.id,
    ...(!agent.model && defaultModel ? { model: defaultModel } : {}),
    home: agent.home ?? join(dataRoot, "agents", agent.id),
    prompt: {
      ...(agent.prompt ?? {}),
      base: agent.prompt?.base ?? { builtIn: "default" },
    },
    tools: materializeAgentToolsDefaults(agent.tools),
  };
}

function materializeAgentToolsDefaults(tools: AgentToolsConfig | undefined): AgentToolsConfig | Record<string, unknown> {
  if (!tools) {
    return [];
  }

  if (Array.isArray(tools)) {
    return tools;
  }

  return {
    ...tools,
    builtIn: tools.builtIn ?? [],
  };
}

function materializeEndpointDefaults(endpoint: EndpointConfig, defaultAgentId: string): Record<string, unknown> {
  switch (endpoint.type) {
    case "telegram":
      return materializeTelegramEndpointDefaults(endpoint, defaultAgentId);
    case "file":
      return materializeFileEndpointDefaults(endpoint, defaultAgentId);
    case "cli":
      return materializeCliEndpointDefaults(endpoint, defaultAgentId);
    default:
      return materializeBaseEndpointDefaults(endpoint, defaultAgentId);
  }
}

function materializeBaseEndpointDefaults(endpoint: EndpointConfig, defaultAgentId: string): Record<string, unknown> {
  return {
    ...endpoint,
    routing: {
      ...(endpoint.routing ?? {}),
      defaultAgentId: endpoint.routing?.defaultAgentId ?? defaultAgentId,
    },
  };
}

function materializeTelegramEndpointDefaults(
  endpoint: TelegramEndpointConfig,
  defaultAgentId: string,
): Record<string, unknown> {
  return {
    ...materializeBaseEndpointDefaults(endpoint, defaultAgentId),
    document: {
      ...(endpoint.document ?? {}),
      maxDownloadBytes: endpoint.document?.maxDownloadBytes ?? defaultTelegramDocumentMaxDownloadBytes,
    },
  };
}

function materializeFileEndpointDefaults(endpoint: FileEndpointConfig, defaultAgentId: string): Record<string, unknown> {
  return {
    ...materializeBaseEndpointDefaults(endpoint, defaultAgentId),
    ingress: {
      ...(endpoint.ingress ?? {}),
      pollIntervalMs: endpoint.ingress?.pollIntervalMs ?? defaultFilePollIntervalMs,
      maxEventBytes: endpoint.ingress?.maxEventBytes ?? defaultFileMaxEventBytes,
    },
  };
}

function materializeCliEndpointDefaults(endpoint: CliEndpointConfig, defaultAgentId: string): Record<string, unknown> {
  return materializeBaseEndpointDefaults(endpoint, defaultAgentId);
}
