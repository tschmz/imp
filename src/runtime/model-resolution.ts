import { getModel, type Api as AiApi, type Model } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";

export type ModelResolver = (provider: string, modelId: string) => Model<AiApi> | undefined;

export function defaultResolveModel(provider: string, modelId: string): Model<AiApi> | undefined {
  return getModel(provider as never, modelId as never);
}

export function resolveModelOrThrow(
  agent: Pick<AgentDefinition, "id" | "model">,
  resolveModel: ModelResolver,
): Model<AiApi> {
  const model = resolveModel(agent.model.provider, agent.model.modelId);
  if (!model) {
    throw new Error(
      `Unknown model for agent "${agent.id}": ` +
        `${agent.model.provider}/${agent.model.modelId}`,
    );
  }

  return model;
}
