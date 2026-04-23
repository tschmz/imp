import { createFindTool, createGrepTool, createLsTool, createCodingTools } from "@mariozechner/pi-coding-agent";
import type { AgentDefinition } from "../domain/agent.js";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";
import { createPhoneCallTools } from "./phone-call-tool.js";
import { resolveBuiltInToolOptions } from "./shell-path.js";
import { createConfiguredSkillTools } from "./skill-tool.js";
import { toUserVisibleToolError } from "./user-visible-tool-error.js";
import {
  createWorkingDirectoryState,
  createWorkingDirectoryTools,
  type WorkingDirectoryState,
} from "./working-directory-tools.js";

export function createBuiltInToolRegistry(
  workingDirectory: string | WorkingDirectoryState,
  agent?: AgentDefinition,
): ToolRegistry {
  const workingDirectoryState = getWorkingDirectoryState(workingDirectory);

  return createToolRegistry([
    ...createDynamicBuiltInTools(workingDirectoryState, agent),
    ...createConfiguredSkillTools(agent?.skillCatalog ?? []),
    ...createWorkingDirectoryTools(workingDirectoryState),
  ]);
}

function getWorkingDirectoryState(workingDirectory: string | WorkingDirectoryState): WorkingDirectoryState {
  return typeof workingDirectory === "string"
    ? createWorkingDirectoryState(workingDirectory)
    : workingDirectory;
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

      return delegatedTool.execute(toolCallId, params, signal, onUpdate).catch((error: unknown) => {
        throw toUserVisibleToolError(error, {
          fallbackMessage: `Built-in tool "${tool.name}" failed.`,
          defaultKind: "tool_command_execution",
        });
      });
    },
  }));
}

function createBaseBuiltInTools(workingDirectory: string, agent?: AgentDefinition): ToolDefinition[] {
  const toolOptions = resolveBuiltInToolOptions(agent);
  return [
    ...createCodingTools(workingDirectory, toolOptions),
    ...createPhoneCallTools(agent?.phone, { agentId: agent?.id }),
    createGrepTool(workingDirectory),
    createFindTool(workingDirectory),
    createLsTool(workingDirectory),
  ];
}
