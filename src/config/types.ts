import type { AgentContextConfig, InferenceSettings, ModelRef } from "../domain/agent.js";
import type { LogLevel } from "../logging/types.js";

export interface InstanceConfig {
  name: string;
}

export interface PathsConfig {
  dataRoot: string;
  authFile?: string;
}

export interface LoggingConfig {
  level: LogLevel;
}

export interface DefaultsConfig {
  agentId: string;
}

export type ModelConfig = ModelRef;

export interface AgentConfig {
  id: string;
  name?: string;
  systemPrompt?: string;
  model?: ModelConfig;
  inference?: InferenceSettings;
  context?: AgentContextConfig;
  tools?: string[];
}

export type BotConfig = TelegramBotConfig;

export interface TelegramBotConfig {
  id: string;
  type: "telegram";
  enabled: boolean;
  token: string;
  access: TelegramAccessConfig;
  routing?: BotRoutingConfig;
}

export interface TelegramAccessConfig {
  allowedUserIds: string[];
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
