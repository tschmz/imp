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
  activeBot: TelegramBotRuntimeConfig;
}

export interface Daemon {
  start(): Promise<void>;
}
