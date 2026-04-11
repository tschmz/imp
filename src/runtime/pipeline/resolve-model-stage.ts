import { resolveModelOrThrow, type ModelResolver } from "../model-resolution.js";
import type { AgentRunContext } from "../types.js";

export interface ResolveModelStageContext extends AgentRunContext {
  model: NonNullable<AgentRunContext["model"]>;
}

export function resolveModelStage(
  context: AgentRunContext,
  dependencies: {
    resolveModel: ModelResolver;
  },
): ResolveModelStageContext {
  const model = resolveModelOrThrow(context.agent, dependencies.resolveModel);
  return {
    ...context,
    model,
  };
}
