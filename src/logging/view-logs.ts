import { readFile, watch } from "node:fs/promises";
import type { DaemonConfig } from "../daemon/types.js";
import { isMissingFileError } from "../files/node-error.js";

export interface LogTarget {
  endpointId: string;
  logFilePath: string;
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
  const multiEndpoint = targets.length > 1;

  for (const target of targets) {
    const recentLines = await readRecentLogLines(target.logFilePath, lines, readFileImpl);
    writeLogLines(stdout, target.endpointId, recentLines, multiEndpoint);
  }

  if (!options.follow) {
    return;
  }

  await followLogTargets({
    targets,
    stdout,
    signal: options.signal,
    multiEndpoint,
    readFile: readFileImpl,
    watch: watchImpl,
  });
}

export function resolveLogTargets(runtimeConfig: DaemonConfig, endpointId?: string): LogTarget[] {
  if (endpointId) {
    const targetBot = runtimeConfig.activeEndpoints.find((endpoint) => endpoint.id === endpointId);
    if (!targetBot) {
      throw new Error(`Unknown endpoint ID: ${endpointId}`);
    }

    return [
      {
        endpointId: targetBot.id,
        logFilePath: targetBot.paths.logFilePath,
      },
    ];
  }

  return runtimeConfig.activeEndpoints.map((endpoint) => ({
    endpointId: endpoint.id,
    logFilePath: endpoint.paths.logFilePath,
  }));
}

export async function readRecentLogLines(
  logFilePath: string,
  lines: number,
  readFileImpl: ReadLogFile = readFile,
): Promise<string[]> {
  try {
    const content = await readFileImpl(logFilePath, "utf8");
    const allLines = content
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    return allLines.slice(-lines);
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
  multiEndpoint: boolean;
  readFile: ReadLogFile;
  watch: WatchLogFile;
}): Promise<void> {
  const abortController = options.signal ? undefined : new AbortController();
  const signal = options.signal ?? abortController?.signal;
  const cleanup = registerFollowCleanup(abortController);
  const offsets = new Map<string, number>();
  const watchers: AsyncIterable<{ eventType: string }>[] = [];
  const pendingWatchTasks: Promise<void>[] = [];

  try {
    for (const target of options.targets) {
      const content = await options.readFile(target.logFilePath, "utf8");
      offsets.set(target.endpointId, content.length);

      const watcher = options.watch(target.logFilePath, {
        signal,
      });
      watchers.push(watcher);

      pendingWatchTasks.push(watchTarget(watcher, target, options, offsets));
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
    multiEndpoint: boolean;
    readFile: ReadLogFile;
  },
  offsets: Map<string, number>,
): Promise<void> {
  try {
    for await (const event of watcher) {
      if (event.eventType !== "change") {
        continue;
      }

      const content = await options.readFile(target.logFilePath, "utf8");
      const previousOffset = offsets.get(target.endpointId) ?? 0;
      const nextChunk = content.slice(previousOffset);
      offsets.set(target.endpointId, content.length);

      const newLines = nextChunk
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

      writeLogLines(options.stdout, target.endpointId, newLines, options.multiEndpoint);
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    throw error;
  }
}

function writeLogLines(
  stdout: NodeJS.WritableStream,
  endpointId: string,
  lines: string[],
  multiEndpoint: boolean,
): void {
  for (const line of lines) {
    stdout.write(multiEndpoint ? `[${endpointId}] ${line}\n` : `${line}\n`);
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
