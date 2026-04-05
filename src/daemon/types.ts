import type { InferenceSettings, ModelRef } from "../domain/agent.js";

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

export interface DaemonConfig {
  paths: RuntimePaths;
  configPath: string;
  defaultAgentId: string;
  agents: ConfiguredAgent[];
  activeBot: TelegramBotRuntimeConfig;
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
}
