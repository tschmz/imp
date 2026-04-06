import type { AgentContextConfig, InferenceSettings, ModelRef } from "../domain/agent.js";
import type { LogLevel } from "../logging/types.js";

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

export interface AgentConfig {
  id: string;
  name?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  model?: ModelConfig;
  authFile?: string;
  inference?: InferenceSettings;
  context?: AgentContextConfig;
  tools?: string[];
}

interface BaseBotConfig {
  id: string;
  enabled: boolean;
  routing?: BotRoutingConfig;
}

export interface TelegramBotConfig extends BaseBotConfig {
  type: "telegram";
  token: string;
  access: TelegramAccessConfig;
}

export type BotConfig = TelegramBotConfig;

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
