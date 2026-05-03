import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { execa } from "execa";
import type { ToolDefinition } from "../../tools/types.js";

const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2000;
const ROLLING_BUFFER_BYTES = DEFAULT_MAX_BYTES * 2;

export interface BashToolOptions {
  shell?: string;
  commandPrefix?: string;
  spawnHook?: BashSpawnHook;
}

export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

interface BashToolDetails {
  truncation?: TruncationDetails;
  fullOutputPath?: string;
}

interface TruncationDetails {
  truncated: boolean;
  truncatedBy: "bytes" | "lines";
  totalBytes: number;
  outputBytes: number;
  totalLines: number;
  outputLines: number;
}

export function createBashTool(workingDirectory: string, options: BashToolOptions = {}): ToolDefinition {
  const parameters = {
    type: "object",
    properties: {
      command: {
        type: "string",
        minLength: 1,
        description: "Bash command to execute",
      },
      timeout: {
        type: "number",
        minimum: 0,
        description: "Timeout in seconds (optional, no default timeout)",
      },
    },
    required: ["command"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    parameters,
    async execute(_toolCallId, params, signal, onUpdate) {
      const { command, timeout } = parseBashParams(params);
      const resolvedCommand = options.commandPrefix ? `${options.commandPrefix}\n${command}` : command;
      const spawnContext = resolveSpawnContext(resolvedCommand, workingDirectory, options.spawnHook);
      const output = createOutputCollector(onUpdate);

      onUpdate?.({ content: [], details: undefined });

      const subprocess = execa(options.shell ?? "bash", ["--noprofile", "--norc", "-c", spawnContext.command], {
        cwd: spawnContext.cwd,
        env: spawnContext.env,
        all: true,
        buffer: false,
        reject: false,
        stripFinalNewline: false,
        ...(timeout !== undefined ? { timeout: timeout * 1000 } : {}),
        ...(signal ? { cancelSignal: signal } : {}),
      });

      subprocess.all?.on("data", (chunk: string | Uint8Array) => {
        output.handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      const result = await subprocess;
      const finalResult = await output.finish();
      let outputText = finalResult.text || "(no output)";

      if (result.isCanceled) {
        outputText = appendMessage(outputText, "Command aborted");
        throw new Error(outputText);
      }

      if (result.timedOut) {
        outputText = appendMessage(outputText, `Command timed out after ${timeout ?? 0} seconds`);
        throw new Error(outputText);
      }

      if (result.exitCode !== undefined && result.exitCode !== 0) {
        outputText = appendMessage(outputText, `Command exited with code ${result.exitCode}`);
        throw new Error(outputText);
      }

      if (result.failed) {
        outputText = appendMessage(outputText, getFailureMessage(result));
        throw new Error(outputText);
      }

      return {
        content: [{ type: "text", text: outputText }],
        details: finalResult.details,
      };
    },
  };
}

function parseBashParams(params: unknown): { command: string; timeout?: number } {
  if (!isRecord(params)) {
    throw new Error("bash requires an object parameter with a command string.");
  }

  const command = params.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("bash requires a non-empty command string.");
  }

  const timeout = params.timeout;
  if (timeout === undefined) {
    return { command };
  }
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) {
    throw new Error("bash timeout must be a non-negative number of seconds when provided.");
  }

  return { command, timeout };
}

function resolveSpawnContext(
  command: string,
  cwd: string,
  spawnHook: BashSpawnHook | undefined,
): BashSpawnContext {
  const context = { command, cwd, env: process.env };
  return spawnHook ? spawnHook(context) : context;
}

function createOutputCollector(onUpdate: Parameters<ToolDefinition["execute"]>[3]) {
  const chunks: Buffer[] = [];
  let chunksBytes = 0;
  let totalBytes = 0;
  let newlineCount = 0;
  let endsWithNewline = false;
  let tempFilePath: string | undefined;
  let tempFileStream: WriteStream | undefined;

  const ensureTempFile = () => {
    if (tempFilePath) {
      return;
    }
    tempFilePath = join(tmpdir(), `imp-bash-output-${randomUUID()}.log`);
    tempFileStream = createWriteStream(tempFilePath);
    for (const chunk of chunks) {
      tempFileStream.write(chunk);
    }
  };

  const currentTotalLines = () => {
    if (totalBytes === 0) {
      return 0;
    }
    return newlineCount + (endsWithNewline ? 0 : 1);
  };

  const renderCurrentOutput = (): FinalOutput => {
    const rawText = Buffer.concat(chunks).toString("utf8");
    return renderOutput(rawText, {
      totalBytes,
      totalLines: currentTotalLines(),
      fullOutputPath: tempFilePath,
    });
  };

  return {
    handleData(chunk: Buffer) {
      totalBytes += chunk.length;
      const chunkText = chunk.toString("utf8");
      newlineCount += countNewlines(chunkText);
      endsWithNewline = chunkText.endsWith("\n");

      if (totalBytes > DEFAULT_MAX_BYTES) {
        ensureTempFile();
      }
      tempFileStream?.write(chunk);

      chunks.push(chunk);
      chunksBytes += chunk.length;
      while (chunksBytes > ROLLING_BUFFER_BYTES && chunks.length > 1) {
        const removed = chunks.shift();
        if (!removed) {
          break;
        }
        chunksBytes -= removed.length;
      }

      if (onUpdate) {
        const current = renderCurrentOutput();
        if (current.details?.truncation?.truncated) {
          ensureTempFile();
        }
        onUpdate({
          content: [{ type: "text", text: current.text }],
          details: current.details,
        });
      }
    },
    async finish(): Promise<FinalOutput> {
      if (totalBytes > DEFAULT_MAX_BYTES || currentTotalLines() > DEFAULT_MAX_LINES) {
        ensureTempFile();
      }
      const output = renderCurrentOutput();
      if (output.details?.truncation?.truncated) {
        output.details.fullOutputPath = tempFilePath;
      }
      if (tempFileStream) {
        tempFileStream.end();
        await once(tempFileStream, "finish");
      }
      return output;
    },
  };
}

interface FinalOutput {
  text: string;
  details?: BashToolDetails;
}

function renderOutput(
  rawText: string,
  metadata: { totalBytes: number; totalLines: number; fullOutputPath?: string },
): FinalOutput {
  const lineTruncated = metadata.totalLines > DEFAULT_MAX_LINES;
  let content = lineTruncated ? rawText.split("\n").slice(-DEFAULT_MAX_LINES).join("\n") : rawText;
  let truncatedBy: TruncationDetails["truncatedBy"] | undefined = lineTruncated ? "lines" : undefined;

  const contentBytes = Buffer.byteLength(content, "utf8");
  if (contentBytes > DEFAULT_MAX_BYTES) {
    content = Buffer.from(content, "utf8").subarray(contentBytes - DEFAULT_MAX_BYTES).toString("utf8");
    truncatedBy = "bytes";
  }

  if (!truncatedBy && metadata.totalBytes <= DEFAULT_MAX_BYTES) {
    return { text: content };
  }

  const outputBytes = Buffer.byteLength(content, "utf8");
  const outputLines = countRenderedLines(content);
  const truncation: TruncationDetails = {
    truncated: true,
    truncatedBy: truncatedBy ?? "bytes",
    totalBytes: metadata.totalBytes,
    outputBytes,
    totalLines: metadata.totalLines,
    outputLines,
  };
  const details: BashToolDetails = {
    truncation,
    ...(metadata.fullOutputPath ? { fullOutputPath: metadata.fullOutputPath } : {}),
  };

  return {
    text: appendTruncationNotice(content, truncation, metadata.fullOutputPath),
    details,
  };
}

function appendTruncationNotice(content: string, truncation: TruncationDetails, fullOutputPath: string | undefined): string {
  const startLine = Math.max(1, truncation.totalLines - truncation.outputLines + 1);
  const pathText = fullOutputPath ? ` Full output: ${fullOutputPath}` : " Full output will be saved to a temp file.";
  const limitText =
    truncation.truncatedBy === "lines"
      ? `Showing lines ${startLine}-${truncation.totalLines} of ${truncation.totalLines}.`
      : `Showing last ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}.`;
  return `${content}\n\n[${limitText}${pathText}]`;
}

function getFailureMessage(result: { shortMessage?: unknown; signal?: unknown }): string {
  if (typeof result.signal === "string" && result.signal.length > 0) {
    return `Command terminated by signal ${result.signal}`;
  }
  if (typeof result.shortMessage === "string" && result.shortMessage.length > 0) {
    return result.shortMessage;
  }
  return "Command failed";
}

function appendMessage(output: string, message: string): string {
  return `${output}${output ? "\n\n" : ""}${message}`;
}

function countNewlines(value: string): number {
  return value.match(/\n/g)?.length ?? 0;
}

function countRenderedLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  const newlines = countNewlines(value);
  return newlines + (value.endsWith("\n") ? 0 : 1);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
