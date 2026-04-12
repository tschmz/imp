import type {
  AgentMcpConfig,
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
  authFile?: string;
  inference?: InferenceSettings;
  workspace?: AgentWorkspaceConfig;
  tools?: AgentToolsConfig;
  skills?: AgentSkillsConfig;
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
}

export interface CliEndpointConfig extends BaseEndpointConfig {
  type: "cli";
}

export type EndpointConfig = TelegramEndpointConfig | CliEndpointConfig;

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

export interface EndpointRoutingConfig {
  defaultAgentId?: string;
}

export interface AppConfig {
  instance: InstanceConfig;
  paths: PathsConfig;
  logging?: LoggingConfig;
  defaults: DefaultsConfig;
  agents: AgentConfig[];
  endpoints: EndpointConfig[];
}
