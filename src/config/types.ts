import type {
  AgentMcpConfig,
  AgentPromptConfig,
  AgentWorkspaceConfig,
  InferenceSettings,
  ModelRef,
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

export interface AgentConfig {
  id: string;
  name?: string;
  prompt: AgentPromptConfig;
  model?: ModelConfig;
  authFile?: string;
  inference?: InferenceSettings;
  workspace?: AgentWorkspaceConfig;
  tools?: AgentToolsConfig;
  skills?: AgentSkillsConfig;
}

interface BaseBotConfig {
  id: string;
  enabled: boolean;
  routing?: BotRoutingConfig;
}

export interface TelegramBotConfig extends BaseBotConfig {
  type: "telegram";
  token: SecretValueConfig;
  access: TelegramAccessConfig;
  voice?: TelegramVoiceConfig;
}

export type BotConfig = TelegramBotConfig;

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

export interface BotRoutingConfig {
  defaultAgentId?: string;
}

export interface AppConfig {
  instance: InstanceConfig;
  paths: PathsConfig;
  logging?: LoggingConfig;
  defaults: DefaultsConfig;
  agents: AgentConfig[];
  bots: BotConfig[];
}
