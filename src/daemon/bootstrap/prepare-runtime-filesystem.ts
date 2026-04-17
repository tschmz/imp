import { mkdir } from "node:fs/promises";
import { rotateLogFileOnStartup } from "../../logging/file-logger.js";
import type { RuntimePaths } from "../types.js";

export async function prepareRuntimeFilesystem(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.endpointRoot, { recursive: true });
  await mkdir(paths.conversationsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runtimeDir, { recursive: true });
  if (paths.plugin) {
    await mkdir(paths.plugin.rootDir, { recursive: true });
    await mkdir(paths.plugin.inboxDir, { recursive: true });
    await mkdir(paths.plugin.processingDir, { recursive: true });
    await mkdir(paths.plugin.processedDir, { recursive: true });
    await mkdir(paths.plugin.failedDir, { recursive: true });
    await mkdir(paths.plugin.outboxDir, { recursive: true });
  }
  await rotateLogFileOnStartup(paths.logFilePath);
}
