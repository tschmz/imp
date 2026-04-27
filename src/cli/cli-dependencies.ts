export interface CliDependencies {
  startDaemon: (options: { configPath?: string }) => Promise<void>;
  startChat: (options: { configPath?: string; endpointId?: string }) => Promise<void>;
  viewLogs: (options: { configPath?: string; endpointId?: string; follow: boolean; lines: number }) => Promise<void>;
  validateConfig: (options: { configPath?: string; preflight?: boolean }) => Promise<void>;
  showConfigSchema: () => Promise<void>;
  reloadConfig: (options: { configPath?: string }) => Promise<void>;
  getConfigValue: (options: { configPath?: string; keyPath: string }) => Promise<void>;
  setConfigValue: (options: { configPath?: string; keyPath: string; value: string }) => Promise<void>;
  initConfig: (options: {
    configPath?: string;
    force: boolean;
  }) => Promise<void>;
  syncManagedSkills: (options: { configPath?: string }) => Promise<void>;
  createBackup: (options: {
    configPath?: string;
    outputPath?: string;
    only?: string;
    force: boolean;
  }) => Promise<void>;
  restoreBackup: (options: {
    configPath?: string;
    dataRoot?: string;
    inputPath: string;
    only?: string;
    force: boolean;
  }) => Promise<void>;
  listPlugins: (options: { root?: string }) => Promise<void>;
  inspectPlugin: (options: { root?: string; id: string }) => Promise<void>;
  doctorPlugin: (options: { configPath?: string; id: string }) => Promise<void>;
  statusPlugin: (options: { configPath?: string; id: string }) => Promise<void>;
  installPlugin: (options: {
    configPath?: string;
    root?: string;
    id: string;
    autoStartServices?: boolean;
    servicesOnly?: boolean;
    force?: boolean;
  }) => Promise<void>;
  installService: (options: { configPath?: string; dryRun: boolean; force: boolean }) => Promise<void>;
  uninstallService: (options: { configPath?: string }) => Promise<void>;
  startService: (options: { configPath?: string }) => Promise<void>;
  stopService: (options: { configPath?: string }) => Promise<void>;
  restartService: (options: { configPath?: string }) => Promise<void>;
  statusService: (options: { configPath?: string }) => Promise<void>;
}
