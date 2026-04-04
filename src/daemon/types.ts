export interface TelegramBotRuntimeConfig {
  id: string;
  type: "telegram";
  token: string;
}

export interface RuntimePaths {
  dataRoot: string;
  botRoot: string;
  conversationsDir: string;
  logsDir: string;
  runtimeDir: string;
}

export interface DaemonConfig {
  paths: RuntimePaths;
  defaultAgentId: string;
  activeBot: TelegramBotRuntimeConfig;
}

export interface Daemon {
  start(): Promise<void>;
}
