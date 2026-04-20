import type {
  AgentMcpConfig,
  AgentPhoneCallConfig,
  AgentWorkspaceConfig,
  InferenceSettings,
  ModelRef,
  PromptSource,
} from "../domain/agent.js";
import type { LogLevel } from "../logging/types.js";
import type { SecretValueConfig } from "./secret-value.js";

export interface InstanceConfig {
  name: string;
}

export interface PathsConfig {
  dataRoot: string;
}

export interface LoggingConfig {
  level: LogLevel;
}

export interface DefaultsConfig {
  agentId: string;
}

export type ModelConfig = ModelRef;

export interface AgentToolsConfigObject {
  builtIn?: string[];
  mcp?: AgentMcpConfig;
  phone?: AgentPhoneCallConfig;
}

export type AgentToolsConfig = string[] | AgentToolsConfigObject;

export interface AgentSkillsConfig {
  paths: string[];
}

export interface AgentPromptConfigInput {
  base?: PromptSource;
  instructions?: PromptSource[];
  references?: PromptSource[];
}

export interface AgentConfig {
  id: string;
  name?: string;
  prompt?: AgentPromptConfigInput;
  model?: ModelConfig;
  home?: string;
  authFile?: string;
  inference?: InferenceSettings;
  workspace?: AgentWorkspaceConfig;
  tools?: AgentToolsConfig;
  skills?: AgentSkillsConfig;
}

export interface PluginConfig {
  id: string;
  enabled: boolean;
  package?: PluginPackageConfig;
}

export interface PluginPackageConfig {
  path: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface BaseEndpointConfig {
  id: string;
  enabled: boolean;
  routing?: EndpointRoutingConfig;
}

export interface TelegramEndpointConfig extends BaseEndpointConfig {
  type: "telegram";
  token: SecretValueConfig;
  access: TelegramAccessConfig;
  voice?: TelegramVoiceConfig;
  document?: TelegramDocumentConfig;
}

export interface CliEndpointConfig extends BaseEndpointConfig {
  type: "cli";
}

export interface FileEndpointConfig extends BaseEndpointConfig {
  type: "file";
  pluginId: string;
  ingress?: FileIngressConfig;
  response: FileResponseRoutingConfig;
}

export interface FileIngressConfig {
  pollIntervalMs?: number;
  maxEventBytes?: number;
}

export type FileResponseRoutingConfig =
  | FileNoOutputResponseRoutingConfig
  | FileEndpointResponseRoutingConfig
  | FileOutboxResponseRoutingConfig;

export interface FileNoOutputResponseRoutingConfig {
  type: "none";
}

export interface FileEndpointResponseRoutingConfig {
  type: "endpoint";
  endpointId: string;
  target: {
    conversationId: string;
    userId?: string;
  };
}

export interface FileOutboxResponseRoutingConfig {
  type: "outbox";
  replyChannel: {
    kind: string;
  };
  priority?: "low" | "normal" | "high";
  ttlMs?: number;
  speech?: FileOutboxSpeechConfig;
}

export interface FileOutboxSpeechConfig {
  enabled?: boolean;
  language?: string;
  model?: string;
  voice?: string;
  instructions?: string;
}

export type EndpointConfig = TelegramEndpointConfig | CliEndpointConfig | FileEndpointConfig;

export interface TelegramAccessConfig {
  allowedUserIds: string[];
}

export interface TelegramVoiceConfig {
  enabled: boolean;
  transcription: TelegramTranscriptionConfig;
}

export interface TelegramTranscriptionConfig {
  provider: "openai";
  model: string;
  language?: string;
}

export interface TelegramDocumentConfig {
  maxDownloadBytes?: number;
}

export interface EndpointRoutingConfig {
  defaultAgentId?: string;
}

export interface AppConfig {
  instance: InstanceConfig;
  paths: PathsConfig;
  logging?: LoggingConfig;
  defaults: DefaultsConfig;
  agents: AgentConfig[];
  plugins?: PluginConfig[];
  endpoints: EndpointConfig[];
}
