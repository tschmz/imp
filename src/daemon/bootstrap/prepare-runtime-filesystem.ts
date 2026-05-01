import { mkdir } from "node:fs/promises";
import type { AgentDefinition } from "../../domain/agent.js";
import { prepareLogFile } from "../../logging/file-logger.js";
import type { RuntimePaths } from "../types.js";

export async function prepareRuntimeFilesystem(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.sessionsDir, { recursive: true });
  await mkdir(paths.bindingsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runtimeDir, { recursive: true });
  if (paths.file) {
    await mkdir(paths.file.rootDir, { recursive: true });
    await mkdir(paths.file.inboxDir, { recursive: true });
    await mkdir(paths.file.processingDir, { recursive: true });
    await mkdir(paths.file.processedDir, { recursive: true });
    await mkdir(paths.file.failedDir, { recursive: true });
    await mkdir(paths.file.outboxDir, { recursive: true });
  }
  await prepareLogFile(paths.logFilePath);
}

export async function prepareAgentHomeDirectories(agents: AgentDefinition[]): Promise<void> {
  const homes = new Set(
    agents
      .map((agent) => agent.home)
      .filter((home): home is string => typeof home === "string" && home.length > 0),
  );

  await Promise.all([...homes].map((home) => mkdir(home, { recursive: true })));
}
