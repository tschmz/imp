import type { StreamOptions } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";
export { createBuiltInToolRegistry } from "./built-in-tool-registry.js";
export { createLoadSkillTool } from "./skill-tool.js";
export { mergeShellPathEntries } from "./shell-path.js";
export {
  createWorkingDirectoryState,
  resolveWorkingDirectory,
  type WorkingDirectoryState,
} from "./working-directory-tools.js";

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
  options: {
    previousResponseId?: string;
    onResolvedPayload?: (
      payload: Record<string, unknown>,
      model: { api: string },
    ) => Promise<void> | void;
  } = {},
): StreamOptions["onPayload"] | undefined {
  const maxOutputTokens = agent.model.inference?.maxOutputTokens;
  const metadata = agent.model.inference?.metadata;
  const request = agent.model.inference?.request;
  if (
    metadata === undefined &&
    request === undefined &&
    maxOutputTokens === undefined &&
    options.previousResponseId === undefined
  ) {
    return undefined;
  }

  return async (payload, model) => {
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

    const nextPayload = {
      ...payload,
      ...(options.previousResponseId !== undefined
        ? { previous_response_id: options.previousResponseId }
        : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(request ?? {}),
    };

    await options.onResolvedPayload?.(nextPayload, model);

    return nextPayload;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
