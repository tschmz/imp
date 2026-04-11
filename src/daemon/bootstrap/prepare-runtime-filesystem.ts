import { mkdir, writeFile } from "node:fs/promises";
import type { RuntimePaths } from "../types.js";

export async function prepareRuntimeFilesystem(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.botRoot, { recursive: true });
  await mkdir(paths.conversationsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeFile(paths.logFilePath, "", { encoding: "utf8", flag: "a" });
}
