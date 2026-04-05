import type { AgentContextConfig, InferenceSettings, ModelRef } from "../domain/agent.js";
import type { LogLevel } from "../logging/types.js";

export interface TelegramBotRuntimeConfig {
  id: string;
  type: "telegram";
  token: string;
  allowedUserIds: string[];
}

export interface RuntimePaths {
  dataRoot: string;
  botRoot: string;
  conversationsDir: string;
  logsDir: string;
  logFilePath: string;
  runtimeDir: string;
  runtimeStatePath: string;
}

export interface ActiveBotRuntimeConfig extends TelegramBotRuntimeConfig {
  defaultAgentId: string;
  paths: RuntimePaths;
}

export interface DaemonConfig {
  configPath: string;
  authFilePath?: string;
  logging: {
    level: LogLevel;
  };
  agents: ConfiguredAgent[];
  activeBots: ActiveBotRuntimeConfig[];
}

export interface Daemon {
  start(): Promise<void>;
}

export interface ConfiguredAgent {
  id: string;
  name?: string;
  systemPrompt?: string;
  model?: ModelRef;
  inference?: InferenceSettings;
  context?: AgentContextConfig;
  tools?: string[];
}
