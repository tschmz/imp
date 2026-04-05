export interface AppConfig {
  instance: InstanceConfig;
  paths: PathsConfig;
  logging?: LoggingConfig;
  defaults: DefaultsConfig;
  bots: BotConfig[];
}

export interface InstanceConfig {
  name: string;
}

export interface PathsConfig {
  dataRoot: string;
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
}

export interface DefaultsConfig {
  agentId: string;
  model?: ModelConfig;
  systemPrompt?: string;
}

export interface ModelConfig {
  provider: string;
  modelId: string;
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
