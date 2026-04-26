import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentDefinition } from "../domain/agent.js";
import type { ToolDefinition } from "../tools/types.js";
import { createUserVisibleToolError, toUserVisibleToolError } from "./user-visible-tool-error.js";

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

export function createWorkingDirectoryTools(workingDirectoryState: WorkingDirectoryState): ToolDefinition[] {
  return [
    createGetWorkingDirectoryTool(workingDirectoryState),
    createSetWorkingDirectoryTool(workingDirectoryState),
  ];
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
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const { path } = parseSetWorkingDirectoryParams(params);
      const workingDirectory = resolve(workingDirectoryState.get(), path);
      const directoryStats = await stat(workingDirectory).catch((error: unknown) => {
        throw toUserVisibleToolError(error, {
          fallbackMessage: `Could not change directory to ${workingDirectory}.`,
          defaultKind: "file_document_persistence",
        });
      });
      if (!directoryStats.isDirectory()) {
        throw createUserVisibleToolError("file_document_persistence", `Not a directory: ${workingDirectory}`);
      }

      workingDirectoryState.set(workingDirectory);
      return {
        content: [{ type: "text", text: workingDirectory }],
        details: { workingDirectory },
      };
    },
  };
}

function parseSetWorkingDirectoryParams(params: unknown): { path: string } {
  if (typeof params !== "object" || params === null) {
    throw createUserVisibleToolError("tool_command_execution", "cd requires an object parameter with a path.");
  }

  const path = "path" in params ? params.path : undefined;
  if (typeof path !== "string" || path.length === 0) {
    throw createUserVisibleToolError("tool_command_execution", "cd requires a non-empty string path.");
  }

  return { path };
}
