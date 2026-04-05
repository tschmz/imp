import { viewDaemonLogs } from "../logging/view-logs.js";
import { resolveRuntimeTarget } from "./runtime-target.js";

export function createViewLogsUseCase(): (options: {
  configPath?: string;
  botId?: string;
  follow: boolean;
  lines: number;
}) => Promise<void> {
  return async ({ configPath, botId, follow, lines }) => {
    const { runtimeConfig } = await resolveRuntimeTarget({ cliConfigPath: configPath });

    await viewDaemonLogs({
      runtimeConfig,
      botId,
      follow,
      lines,
    });
  };
}
