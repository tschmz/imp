export interface TelegramBotRuntimeConfig {
  id: string;
  type: "telegram";
  token: string;
}

export interface DaemonConfig {
  dataDir: string;
  defaultAgentId: string;
  activeBot: TelegramBotRuntimeConfig;
}

export interface Daemon {
  start(): Promise<void>;
}
