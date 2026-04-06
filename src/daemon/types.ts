import type { AgentContextConfig, InferenceSettings, ModelRef } from "../domain/agent.js";
import type { LogLevel } from "../logging/types.js";
import type { TransportType } from "../transports/registry.js";

interface BaseTransportRuntimeConfig {
  id: string;
  type: TransportType;
}

export interface TelegramBotRuntimeConfig extends BaseTransportRuntimeConfig {
  type: "telegram";
  token: string;
  allowedUserIds: string[];
}

export type TransportBotRuntimeConfig = TelegramBotRuntimeConfig;

export interface RuntimePaths {
  dataRoot: string;
  botRoot: string;
  conversationsDir: string;
  logsDir: string;
  logFilePath: string;
  runtimeDir: string;
  runtimeStatePath: string;
}

export type ActiveBotRuntimeConfig = TransportBotRuntimeConfig & {
  defaultAgentId: string;
  paths: RuntimePaths;
};

export interface DaemonConfig {
  configPath: string;
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
  systemPromptFile?: string;
  model?: ModelRef;
  authFile?: string;
  inference?: InferenceSettings;
  context?: AgentContextConfig;
  tools?: string[];
}
