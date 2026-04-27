import { readFile, watch } from "node:fs/promises";
import type { DaemonConfig } from "../daemon/types.js";
import { isMissingFileError } from "../files/node-error.js";

export interface LogTarget {
  endpointId: string;
  logFilePath: string;
  filterEndpointId?: string;
}

type ReadLogFile = (path: string, encoding: "utf8") => Promise<string>;
type WatchLogFile = (
  path: string,
  options: { signal?: AbortSignal },
) => AsyncIterable<{ eventType: string }>;

interface ViewLogsDependencies {
  readFile?: ReadLogFile;
  watch?: WatchLogFile;
}

export async function viewDaemonLogs(options: {
  runtimeConfig: DaemonConfig;
  endpointId?: string;
  lines?: number;
  follow?: boolean;
  stdout?: NodeJS.WritableStream;
  signal?: AbortSignal;
  dependencies?: ViewLogsDependencies;
}): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const readFileImpl: ReadLogFile = options.dependencies?.readFile ?? readFile;
  const watchImpl: WatchLogFile = options.dependencies?.watch ?? watch;
  const lines = options.lines ?? 50;

  assertPositiveLineCount(lines);
  const targets = resolveLogTargets(options.runtimeConfig, options.endpointId);
  const initialOffsets = new Map<string, number>();

  for (const target of targets) {
    const snapshot = await readLogSnapshot(target.logFilePath, lines, readFileImpl, target.filterEndpointId);
    initialOffsets.set(target.logFilePath, snapshot.offset);
    writeLogLines(stdout, snapshot.recentLines);
  }

  if (!options.follow) {
    return;
  }

  await followLogTargets({
    targets,
    stdout,
    signal: options.signal,
    readFile: readFileImpl,
    watch: watchImpl,
    initialOffsets,
  });
}

export function resolveLogTargets(runtimeConfig: DaemonConfig, endpointId?: string): LogTarget[] {
  if (endpointId) {
    const targetEndpoint = runtimeConfig.activeEndpoints.find((endpoint) => endpoint.id === endpointId);
    if (!targetEndpoint) {
      throw new Error(`Unknown endpoint ID: ${endpointId}`);
    }

    return [
      {
        endpointId: targetEndpoint.id,
        logFilePath: targetEndpoint.paths.logFilePath,
        filterEndpointId: targetEndpoint.id,
      },
    ];
  }

  const uniqueTargets = new Map<string, LogTarget>();
  for (const endpoint of runtimeConfig.activeEndpoints) {
    uniqueTargets.set(endpoint.paths.logFilePath, {
      endpointId: endpoint.id,
      logFilePath: endpoint.paths.logFilePath,
    });
  }

  return [...uniqueTargets.values()];
}

export async function readRecentLogLines(
  logFilePath: string,
  lines: number,
  readFileImpl: ReadLogFile = readFile,
  filterEndpointId?: string,
): Promise<string[]> {
  const snapshot = await readLogSnapshot(logFilePath, lines, readFileImpl, filterEndpointId);
  return snapshot.recentLines;
}

async function readLogSnapshot(
  logFilePath: string,
  lines: number,
  readFileImpl: ReadLogFile,
  filterEndpointId?: string,
): Promise<{ recentLines: string[]; offset: number }> {
  try {
    const content = await readFileImpl(logFilePath, "utf8");
    const allLines = content
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => shouldIncludeLogLine(line, filterEndpointId));

    return {
      recentLines: allLines.slice(-lines),
      offset: content.length,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Log file not found: ${logFilePath}`);
    }

    throw error;
  }
}

async function followLogTargets(options: {
  targets: LogTarget[];
  stdout: NodeJS.WritableStream;
  signal?: AbortSignal;
  readFile: ReadLogFile;
  watch: WatchLogFile;
  initialOffsets: Map<string, number>;
}): Promise<void> {
  const abortController = options.signal ? undefined : new AbortController();
  const signal = options.signal ?? abortController?.signal;
  const cleanup = registerFollowCleanup(abortController);
  const offsets = new Map(options.initialOffsets);
  const watchers: AsyncIterable<{ eventType: string }>[] = [];
  const pendingWatchTasks: Promise<void>[] = [];

  try {
    for (const target of options.targets) {
      const watcher = options.watch(target.logFilePath, {
        signal,
      });
      watchers.push(watcher);

      pendingWatchTasks.push(watchTarget(watcher, target, options, offsets));
    }

    for (const target of options.targets) {
      await writeNewLogLines(target, options, offsets);
    }

    if (!signal) {
      return;
    }

    await waitForAbort(signal);
  } finally {
    cleanup.dispose();
    await Promise.allSettled(watchers.map((watcher) => closeWatcher(watcher)));
    await Promise.allSettled(pendingWatchTasks);
  }
}

async function watchTarget(
  watcher: AsyncIterable<{ eventType: string }>,
  target: LogTarget,
  options: {
    stdout: NodeJS.WritableStream;
    readFile: ReadLogFile;
  },
  offsets: Map<string, number>,
): Promise<void> {
  try {
    for await (const event of watcher) {
      if (event.eventType !== "change") {
        continue;
      }

      await writeNewLogLines(target, options, offsets);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    throw error;
  }
}

async function writeNewLogLines(
  target: LogTarget,
  options: {
    stdout: NodeJS.WritableStream;
    readFile: ReadLogFile;
  },
  offsets: Map<string, number>,
): Promise<void> {
  const content = await options.readFile(target.logFilePath, "utf8");
  const previousOffset = offsets.get(target.logFilePath) ?? 0;
  const effectiveOffset = content.length < previousOffset ? 0 : previousOffset;
  const nextChunk = content.slice(effectiveOffset);

  const newLines = nextChunk
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => shouldIncludeLogLine(line, target.filterEndpointId));

  writeLogLines(options.stdout, newLines);
  offsets.set(target.logFilePath, content.length);
}

function writeLogLines(stdout: NodeJS.WritableStream, lines: string[]): void {
  for (const line of lines) {
    stdout.write(`${line}\n`);
  }
}

function shouldIncludeLogLine(line: string, filterEndpointId: string | undefined): boolean {
  if (line.length === 0) {
    return false;
  }

  if (!filterEndpointId) {
    return true;
  }

  try {
    const parsed = JSON.parse(line) as { endpointId?: unknown };
    return parsed.endpointId === filterEndpointId;
  } catch {
    return false;
  }
}

function assertPositiveLineCount(lines: number): void {
  if (!Number.isInteger(lines) || lines <= 0) {
    throw new Error("`--lines` must be a positive integer.");
  }
}

function registerFollowCleanup(abortController: AbortController | undefined): { dispose(): void } {
  if (!abortController) {
    return {
      dispose() {},
    };
  }

  const abort = () => {
    abortController.abort();
  };

  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  return {
    dispose() {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    },
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function closeWatcher(watcher: AsyncIterable<{ eventType: string }>): Promise<void> {
  const iterator = watcher[Symbol.asyncIterator]();
  if (typeof iterator.return !== "function") {
    return;
  }

  try {
    await iterator.return();
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      (error.name === "Error" && error.message.includes("This operation was aborted")))
  );
}
