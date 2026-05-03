import { createBashTool } from "./tools/bash-tool.js";
import { createEditTool } from "./tools/edit-tool.js";
import { createFindTool } from "./tools/find-tool.js";
import { createGrepTool } from "./tools/grep-tool.js";
import { createLsTool } from "./tools/ls-tool.js";
import { createReadTool } from "./tools/read-tool.js";
import { createWriteTool } from "./tools/write-tool.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { AgentDefinition } from "../domain/agent.js";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";
import { resolveBuiltInToolOptions } from "./shell-path.js";
import { createConfiguredSkillTools } from "./tools/skill-tool.js";
import { createUpdatePlanTool } from "./tools/update-plan-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createAttachFileTool, createAttachmentCollector, type AttachmentCollector } from "./tools/attach-file-tool.js";
import { toUserVisibleToolError } from "./user-visible-tool-error.js";
import {
  createWorkingDirectoryState,
  createWorkingDirectoryTools,
  type WorkingDirectoryState,
} from "./tools/working-directory-tools.js";

const sequentialDynamicToolNames = new Set(["bash", "edit", "write"]);

export function createBuiltInToolRegistry(
  workingDirectory: string | WorkingDirectoryState,
  agent?: AgentDefinition,
  attachmentCollector?: AttachmentCollector,
  context?: {
    dataRoot?: string;
    conversation?: ConversationContext;
  },
): ToolRegistry {
  const workingDirectoryState = getWorkingDirectoryState(workingDirectory);
  const activeAttachmentCollector = attachmentCollector ?? createAttachmentCollector();

  return createToolRegistry([
    ...createDynamicBuiltInTools(workingDirectoryState, agent, activeAttachmentCollector, context),
    ...createConfiguredSkillTools(agent?.skillCatalog ?? []),
    ...createCronTool(agent),
    createUpdatePlanTool(),
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
  attachmentCollector?: AttachmentCollector,
  context?: {
    dataRoot?: string;
    conversation?: ConversationContext;
  },
): ToolDefinition[] {
  return createBaseBuiltInTools(workingDirectoryState.get(), agent, attachmentCollector, context).map((tool) => ({
    ...tool,
    ...(sequentialDynamicToolNames.has(tool.name) ? { executionMode: "sequential" as const } : {}),
    async execute(toolCallId, params, signal, onUpdate) {
      const delegatedTool = createBaseBuiltInTools(workingDirectoryState.get(), agent, attachmentCollector, context).find(
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

function createBaseBuiltInTools(
  workingDirectory: string,
  agent?: AgentDefinition,
  attachmentCollector?: AttachmentCollector,
  context?: {
    dataRoot?: string;
    conversation?: ConversationContext;
  },
): ToolDefinition[] {
  const toolOptions = resolveBuiltInToolOptions(agent);
  return [
    createEditTool(workingDirectory),
    createReadTool(workingDirectory),
    createWriteTool(workingDirectory),
    createBashTool(workingDirectory, toolOptions?.bash),
    createGrepTool(workingDirectory),
    createFindTool(workingDirectory),
    createLsTool(workingDirectory),
    ...(attachmentCollector ? [createAttachFileTool(workingDirectory, attachmentCollector, context)] : []),
  ];
}
