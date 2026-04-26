import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { PluginToolManifest } from "../plugins/manifest.js";
import type { ToolDefinition } from "../tools/types.js";
import { createUserVisibleToolError, toUserVisibleToolError } from "./user-visible-tool-error.js";

export interface CommandToolRuntimeConfig {
  pluginId: string;
  pluginRoot: string;
  manifest: PluginToolManifest;
}

interface CommandToolRequest {
  schemaVersion: 1;
  pluginId: string;
  toolName: string;
  input: unknown;
}

export function createCommandToolDefinitions(tools: CommandToolRuntimeConfig[]): ToolDefinition[] {
  return tools.map((tool) => createCommandToolDefinition(tool));
}

function createCommandToolDefinition(tool: CommandToolRuntimeConfig): ToolDefinition {
  const fullName = `${tool.pluginId}.${tool.manifest.name}`;

  return {
    name: fullName,
    label: fullName,
    description: tool.manifest.description,
    parameters: normalizeInputSchema(tool.manifest.inputSchema),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      return executeCommandTool(tool, fullName, params, signal).catch((error: unknown) => {
        throw toUserVisibleToolError(error, {
          fallbackMessage: `Plugin tool "${fullName}" failed.`,
          defaultKind: "tool_command_execution",
        });
      });
    },
  };
}

async function executeCommandTool(
  tool: CommandToolRuntimeConfig,
  fullName: string,
  params: unknown,
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<unknown>> {
  const runner = tool.manifest.runner;
  const request: CommandToolRequest = {
    schemaVersion: 1,
    pluginId: tool.pluginId,
    toolName: fullName,
    input: params,
  };

  const result = await runCommand({
    command: runner.command,
    args: runner.args ?? [],
    cwd: runner.cwd ? resolve(tool.pluginRoot, runner.cwd) : tool.pluginRoot,
    env: runner.env,
    input: `${JSON.stringify(request)}\n`,
    timeoutMs: runner.timeoutMs,
    signal,
  });

  if (result.exitCode !== 0) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      `Plugin tool "${fullName}" exited with code ${result.exitCode}.${result.stderr ? `\n${result.stderr.trim()}` : ""}`,
    );
  }

  return parseToolOutput(result.stdout);
}

interface RunCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  input: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface RunCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          rejectOnce(createUserVisibleToolError("tool_command_execution", `Plugin tool command timed out after ${options.timeoutMs}ms.`));
        }, options.timeoutMs)
      : undefined;

    const abort = () => {
      child.kill("SIGTERM");
      rejectOnce(createUserVisibleToolError("tool_command_execution", "Plugin tool command was aborted."));
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", rejectOnce);
    child.on("close", (exitCode) => {
      cleanup();
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(options.input);

    function rejectOnce(error: unknown) {
      cleanup();
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    }

    function cleanup() {
      if (timeout) {
        clearTimeout(timeout);
      }
      options.signal?.removeEventListener("abort", abort);
    }
  });
}

function parseToolOutput(stdout: string): AgentToolResult<unknown> {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { content: [{ type: "text", text: "" }], details: {} };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed) && Array.isArray(parsed.content)) {
      return parsed as unknown as AgentToolResult<unknown>;
    }

    return {
      content: [{ type: "text", text: trimmed }],
      details: parsed,
    };
  } catch {
    return { content: [{ type: "text", text: stdout }], details: { stdout } };
  }
}

function normalizeInputSchema(schema: Record<string, unknown> | undefined): ToolDefinition["parameters"] {
  return (schema ?? {
    type: "object",
    properties: {},
    additionalProperties: true,
  }) as ToolDefinition["parameters"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
