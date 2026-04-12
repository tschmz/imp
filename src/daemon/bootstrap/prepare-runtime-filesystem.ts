import { mkdir } from "node:fs/promises";
import { rotateLogFileOnStartup } from "../../logging/file-logger.js";
import type { RuntimePaths } from "../types.js";

export async function prepareRuntimeFilesystem(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.endpointRoot, { recursive: true });
  await mkdir(paths.conversationsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runtimeDir, { recursive: true });
  await rotateLogFileOnStartup(paths.logFilePath);
}
