import type {
  AgentMcpConfig,
  AgentPromptConfig,
  AgentSkillsConfig,
  AgentWorkspaceConfig,
  InferenceSettings,
  ModelRef,
} from "../domain/agent.js";
import type { LogLevel } from "../logging/types.js";
import type { SkillDefinition } from "../skills/types.js";
import type { TransportType } from "../transports/registry.js";

interface BaseTransportRuntimeConfig {
  id: string;
  type: TransportType;
}

export interface TelegramEndpointRuntimeConfig extends BaseTransportRuntimeConfig {
  type: "telegram";
  token: string;
  allowedUserIds: string[];
  voice?: TelegramVoiceRuntimeConfig;
  document?: TelegramDocumentRuntimeConfig;
}

export interface CliEndpointRuntimeConfig extends BaseTransportRuntimeConfig {
  type: "cli";
  userId: string;
}

export interface PluginEndpointRuntimeConfig extends BaseTransportRuntimeConfig {
  type: "plugin";
  pluginId: string;
  ingress: PluginIngressRuntimeConfig;
  response: PluginResponseRoutingRuntimeConfig;
}

export interface PluginIngressRuntimeConfig {
  pollIntervalMs: number;
  maxEventBytes: number;
}

export type PluginResponseRoutingRuntimeConfig =
  | { type: "none" }
  | {
      type: "endpoint";
      endpointId: string;
      target: {
        conversationId: string;
        userId?: string;
      };
    }
  | {
      type: "outbox";
      replyChannel: {
        kind: string;
      };
      priority?: "low" | "normal" | "high";
      ttlMs?: number;
      speech?: {
        enabled?: boolean;
        language?: string;
        voice?: string;
        instructions?: string;
      };
    };

export interface TelegramVoiceRuntimeConfig {
  enabled: boolean;
  transcription: TelegramTranscriptionRuntimeConfig;
}

export interface TelegramTranscriptionRuntimeConfig {
  provider: "openai";
  model: string;
  language?: string;
}

export interface TelegramDocumentRuntimeConfig {
  maxDownloadBytes: number;
}

export type TransportEndpointRuntimeConfig =
  | TelegramEndpointRuntimeConfig
  | CliEndpointRuntimeConfig
  | PluginEndpointRuntimeConfig;

export interface RuntimePaths {
  dataRoot: string;
  endpointRoot: string;
  conversationsDir: string;
  logsDir: string;
  logFilePath: string;
  runtimeDir: string;
  runtimeStatePath: string;
  plugin?: PluginRuntimePaths;
}

export interface PluginRuntimePaths {
  rootDir: string;
  inboxDir: string;
  processingDir: string;
  processedDir: string;
  failedDir: string;
  outboxDir: string;
}

export type ActiveEndpointRuntimeConfig = TransportEndpointRuntimeConfig & {
  defaultAgentId: string;
  paths: RuntimePaths;
};

export interface DaemonConfig {
  configPath: string;
  logging: {
    level: LogLevel;
  };
  agents: ConfiguredAgent[];
  activeEndpoints: ActiveEndpointRuntimeConfig[];
}

export interface Daemon {
  start(): Promise<void>;
}

export interface ConfiguredAgent {
  id: string;
  name?: string;
  prompt: AgentPromptConfig;
  model?: ModelRef;
  home?: string;
  authFile?: string;
  inference?: InferenceSettings;
  workspace?: AgentWorkspaceConfig;
  skills?: AgentSkillsConfig;
  skillCatalog?: SkillDefinition[];
  skillIssues?: string[];
  tools?: string[];
  mcp?: AgentMcpConfig;
}
