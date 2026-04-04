export interface DaemonConfig {
  dataDir: string;
  defaultAgentId: string;
  telegram?: {
    botToken: string;
  };
}

export interface Daemon {
  start(): Promise<void>;
}
