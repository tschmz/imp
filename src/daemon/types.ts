export interface TelegramBotRuntimeConfig {
  id: string;
  type: "telegram";
  token: string;
}

export interface DaemonConfig {
  dataRoot: string;
  botDataDir: string;
  defaultAgentId: string;
  activeBot: TelegramBotRuntimeConfig;
}

export interface Daemon {
  start(): Promise<void>;
}
