import { stat } from "node:fs/promises";
import { delimiter as pathDelimiter } from "node:path";
import { createFindTool, createGrepTool, createLsTool, createCodingTools, type ToolsOptions } from "@mariozechner/pi-coding-agent";
import type { StreamOptions } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";

export interface WorkingDirectoryState {
  get(): string;
  set(path: string): void;
}

export function resolveWorkingDirectory(agent: AgentDefinition): string {
  return agent.workspace?.cwd ?? process.cwd();
}

export function createWorkingDirectoryState(initialWorkingDirectory: string): WorkingDirectoryState {
  let workingDirectory = initialWorkingDirectory;

  return {
    get() {
      return workingDirectory;
    },
    set(path: string) {
      workingDirectory = path;
    },
  };
}

export function createBuiltInToolRegistry(
  workingDirectory: string | WorkingDirectoryState,
  agent?: AgentDefinition,
): ToolRegistry {
  const workingDirectoryState =
    typeof workingDirectory === "string"
      ? createWorkingDirectoryState(workingDirectory)
      : workingDirectory;

  return createToolRegistry([
    ...createDynamicBuiltInTools(workingDirectoryState, agent),
    createGetWorkingDirectoryTool(workingDirectoryState),
    createSetWorkingDirectoryTool(workingDirectoryState),
  ]);
}

function createDynamicBuiltInTools(
  workingDirectoryState: WorkingDirectoryState,
  agent?: AgentDefinition,
): ToolDefinition[] {
  return createBaseBuiltInTools(workingDirectoryState.get(), agent).map((tool) => ({
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      const delegatedTool = createBaseBuiltInTools(workingDirectoryState.get(), agent).find(
        (candidate) => candidate.name === tool.name,
      );
      if (!delegatedTool) {
        throw new Error(`Unknown built-in tool: ${tool.name}`);
      }

      return delegatedTool.execute(toolCallId, params, signal, onUpdate);
    },
  }));
}

function createBaseBuiltInTools(workingDirectory: string, agent?: AgentDefinition): ToolDefinition[] {
  const toolOptions = resolveBuiltInToolOptions(agent);
  return [
    ...createCodingTools(workingDirectory, toolOptions),
    createGrepTool(workingDirectory),
    createFindTool(workingDirectory),
    createLsTool(workingDirectory),
  ];
}

function resolveBuiltInToolOptions(agent?: AgentDefinition): ToolsOptions | undefined {
  const shellPath = agent?.workspace?.shellPath;
  if (!shellPath || shellPath.length === 0) {
    return undefined;
  }

  return {
    bash: {
      spawnHook: ({ command, cwd, env }) => ({
        command,
        cwd,
        env: mergeShellPathEntries(env, shellPath),
      }),
    },
  };
}

export function mergeShellPathEntries(
  env: NodeJS.ProcessEnv,
  additionalEntries: string[],
  options: { delimiter?: string; platform?: NodeJS.Platform } = {},
): NodeJS.ProcessEnv {
  const delimiter = options.delimiter ?? pathDelimiter;
  const platform = options.platform ?? process.platform;
  const pathKey = resolvePathEnvironmentKey(env, platform);
  const currentPath = env[pathKey];
  const envWithoutDuplicatePathKeys = removeDuplicatePathKeys(env, platform);

  return {
    ...envWithoutDuplicatePathKeys,
    [pathKey]: appendPathEntries(currentPath, additionalEntries, delimiter),
  };
}

function resolvePathEnvironmentKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    if ("Path" in env) {
      return "Path";
    }

    if ("PATH" in env) {
      return "PATH";
    }

    const existingKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
    if (existingKey) {
      return existingKey;
    }

    return "Path";
  }

  return "PATH";
}

function removeDuplicatePathKeys(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  if (platform !== "win32") {
    return env;
  }

  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
  );
}

function appendPathEntries(
  currentPath: string | undefined,
  additionalEntries: string[],
  delimiter: string,
): string {
  const mergedEntries = [
    ...splitPathEntries(currentPath, delimiter),
    ...additionalEntries,
  ];

  return [...new Set(mergedEntries)].join(delimiter);
}

function splitPathEntries(pathValue: string | undefined, delimiter: string): string[] {
  if (!pathValue) {
    return [];
  }

  return pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function createGetWorkingDirectoryTool(workingDirectoryState: WorkingDirectoryState): ToolDefinition {
  const parameters = {
    type: "object",
    properties: {},
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: "pwd",
    label: "pwd",
    description: "Return the current working directory used by filesystem and shell tools.",
    parameters,
    async execute() {
      const workingDirectory = workingDirectoryState.get();
      return {
        content: [{ type: "text", text: workingDirectory }],
        details: { workingDirectory },
      };
    },
  };
}

function createSetWorkingDirectoryTool(workingDirectoryState: WorkingDirectoryState): ToolDefinition {
  const parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        minLength: 1,
      },
    },
    required: ["path"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: "cd",
    label: "cd",
    description: "Set the working directory used by subsequent filesystem and shell tool calls.",
    parameters,
    async execute(_toolCallId, params) {
      const { path } = parseSetWorkingDirectoryParams(params);
      const directoryStats = await stat(path);
      if (!directoryStats.isDirectory()) {
        throw new Error(`Not a directory: ${path}`);
      }

      workingDirectoryState.set(path);
      return {
        content: [{ type: "text", text: path }],
        details: { workingDirectory: path },
      };
    },
  };
}

function parseSetWorkingDirectoryParams(params: unknown): { path: string } {
  if (typeof params !== "object" || params === null) {
    throw new Error("cd requires an object parameter with a path.");
  }

  const path = "path" in params ? params.path : undefined;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("cd requires a non-empty string path.");
  }

  return { path };
}

export function resolveAgentTools(
  agent: AgentDefinition,
  toolRegistry: ToolRegistry,
): ToolDefinition[] {
  if (agent.tools.length === 0) {
    return [];
  }

  const resolvedTools = toolRegistry.pick(agent.tools);
  const resolvedNames = new Set(resolvedTools.map((tool) => tool.name));
  const missingTools = agent.tools.filter((name) => !resolvedNames.has(name));
  if (missingTools.length > 0) {
    throw new Error(
      `Unknown tools for agent "${agent.id}": ${missingTools.join(", ")}`,
    );
  }

  return resolvedTools;
}

export function createOnPayloadOverride(
  agent: AgentDefinition,
): StreamOptions["onPayload"] | undefined {
  const maxOutputTokens = agent.inference?.maxOutputTokens;
  const metadata = agent.inference?.metadata;
  const request = agent.inference?.request;
  if (
    metadata === undefined &&
    request === undefined &&
    maxOutputTokens === undefined
  ) {
    return undefined;
  }

  return (payload, model) => {
    if (
      model.api !== "openai-responses" &&
      model.api !== "openai-codex-responses" &&
      model.api !== "azure-openai-responses"
    ) {
      return undefined;
    }

    if (!isRecord(payload)) {
      return undefined;
    }

    return {
      ...payload,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(request ?? {}),
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
