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
