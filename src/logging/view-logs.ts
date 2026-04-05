import { readFile, watch } from "node:fs/promises";
import type { DaemonConfig } from "../daemon/types.js";

export interface LogTarget {
  botId: string;
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
  botId?: string;
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
  const targets = resolveLogTargets(options.runtimeConfig, options.botId);
  const multiBot = targets.length > 1;

  for (const target of targets) {
    const recentLines = await readRecentLogLines(target.logFilePath, lines, readFileImpl);
    writeLogLines(stdout, target.botId, recentLines, multiBot);
  }

  if (!options.follow) {
    return;
  }

  await followLogTargets({
    targets,
    stdout,
    signal: options.signal,
    multiBot,
    readFile: readFileImpl,
    watch: watchImpl,
  });
}

export function resolveLogTargets(runtimeConfig: DaemonConfig, botId?: string): LogTarget[] {
  if (botId) {
    const targetBot = runtimeConfig.activeBots.find((bot) => bot.id === botId);
    if (!targetBot) {
      throw new Error(`Unknown bot ID: ${botId}`);
    }

    return [
      {
        botId: targetBot.id,
        logFilePath: targetBot.paths.logFilePath,
      },
    ];
  }

  return runtimeConfig.activeBots.map((bot) => ({
    botId: bot.id,
    logFilePath: bot.paths.logFilePath,
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
  multiBot: boolean;
  readFile: ReadLogFile;
  watch: WatchLogFile;
}): Promise<void> {
  const abortController = options.signal ? undefined : new AbortController();
  const signal = options.signal ?? abortController?.signal;
  const cleanup = registerFollowCleanup(abortController);
  const offsets = new Map<string, number>();
  const pendingWatchTasks: Promise<void>[] = [];

  try {
    for (const target of options.targets) {
      const content = await options.readFile(target.logFilePath, "utf8");
      offsets.set(target.botId, content.length);

      const watcher = options.watch(target.logFilePath, {
        signal,
      });

      pendingWatchTasks.push(watchTarget(watcher, target, options, offsets));
    }

    if (!signal) {
      return;
    }

    await waitForAbort(signal);
  } finally {
    cleanup.dispose();
    await Promise.allSettled(pendingWatchTasks);
  }
}

async function watchTarget(
  watcher: AsyncIterable<{ eventType: string }>,
  target: LogTarget,
  options: {
    stdout: NodeJS.WritableStream;
    multiBot: boolean;
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
      const previousOffset = offsets.get(target.botId) ?? 0;
      const nextChunk = content.slice(previousOffset);
      offsets.set(target.botId, content.length);

      const newLines = nextChunk
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

      writeLogLines(options.stdout, target.botId, newLines, options.multiBot);
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
  botId: string,
  lines: string[],
  multiBot: boolean,
): void {
  for (const line of lines) {
    stdout.write(multiBot ? `[${botId}] ${line}\n` : `${line}\n`);
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

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      (error.name === "Error" && error.message.includes("This operation was aborted")))
  );
}
