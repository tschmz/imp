import { viewDaemonLogs } from "../logging/view-logs.js";
import { resolveRuntimeTarget } from "./runtime-target.js";

export function createViewLogsUseCase(): (options: {
  configPath?: string;
  endpointId?: string;
  follow: boolean;
  lines: number;
}) => Promise<void> {
  return async ({ configPath, endpointId, follow, lines }) => {
    const { runtimeConfig } = await resolveRuntimeTarget({ cliConfigPath: configPath });

    await viewDaemonLogs({
      runtimeConfig,
      endpointId,
      follow,
      lines,
    });
  };
}
