import { readFile, unlink, writeFile } from "node:fs/promises";

export interface RuntimeState {
  pid: number;
  endpointId: string;
  startedAt: string;
  configPath: string;
  logFilePath: string;
}

export async function writeRuntimeState(path: string, state: RuntimeState): Promise<void> {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function assertNoRunningInstance(path: string): Promise<void> {
  const existingState = await readRuntimeState(path);
  if (existingState === undefined) {
    return;
  }

  if (existingState === null) {
    await cleanupRuntimeState(path);
    return;
  }

  if (existingState.pid === process.pid) {
    return;
  }

  if (isProcessRunning(existingState.pid)) {
    throw new Error(
      `Another daemon instance is already running with pid ${existingState.pid}.`,
    );
  }

  await cleanupRuntimeState(path);
}

export async function cleanupRuntimeState(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

async function readRuntimeState(path: string): Promise<RuntimeState | null | undefined> {
  try {
    return parseRuntimeState(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function parseRuntimeState(content: string): RuntimeState | null {
  let value: Partial<RuntimeState>;

  try {
    value = JSON.parse(content) as Partial<RuntimeState>;
  } catch {
    return null;
  }

  if (
    !Number.isInteger(value.pid) ||
    value.pid === undefined ||
    value.pid <= 0 ||
    typeof value.endpointId !== "string" ||
    value.endpointId.length === 0 ||
    typeof value.startedAt !== "string" ||
    value.startedAt.length === 0 ||
    typeof value.configPath !== "string" ||
    value.configPath.length === 0 ||
    typeof value.logFilePath !== "string" ||
    value.logFilePath.length === 0
  ) {
    return null;
  }

  return {
    pid: value.pid,
    endpointId: value.endpointId,
    startedAt: value.startedAt,
    configPath: value.configPath,
    logFilePath: value.logFilePath,
  };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false;
    }

    if (isPermissionProcessError(error)) {
      return true;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isMissingProcessError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function isPermissionProcessError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}
