import { getModel, type Api as AiApi, type Model } from "@mariozechner/pi-ai";
import type { AgentDefinition, ModelRef } from "../domain/agent.js";

export type ModelResolver = (provider: string, modelId: string) => Model<AiApi> | undefined;

export function defaultResolveModel(provider: string, modelId: string): Model<AiApi> | undefined {
  return getModel(provider as never, modelId as never);
}

export function resolveModelOrThrow(
  agent: Pick<AgentDefinition, "id" | "model">,
  resolveModel: ModelResolver,
): Model<AiApi> {
  const model = resolveConfiguredModel(agent.model, resolveModel);
  if (!model) {
    throw new Error(
      `Unknown model for agent "${agent.id}": ` +
        `${agent.model.provider}/${agent.model.modelId}`,
    );
  }

  return model;
}

export function resolveConfiguredModel(
  configuredModel: ModelRef,
  resolveModel: ModelResolver,
): Model<AiApi> | undefined {
  const resolvedModel = resolveModel(configuredModel.provider, configuredModel.modelId);
  if (resolvedModel) {
    return applyConfiguredOverrides(resolvedModel, configuredModel);
  }

  return buildCustomModel(configuredModel);
}

function applyConfiguredOverrides(
  resolvedModel: Model<AiApi>,
  configuredModel: ModelRef,
): Model<AiApi> {
  if (!hasCustomModelOverrides(configuredModel)) {
    return resolvedModel;
  }

  return {
    ...resolvedModel,
    ...(configuredModel.baseUrl ? { baseUrl: configuredModel.baseUrl } : {}),
    ...(configuredModel.reasoning !== undefined ? { reasoning: configuredModel.reasoning } : {}),
    ...(configuredModel.input ? { input: configuredModel.input } : {}),
    ...(configuredModel.contextWindow ? { contextWindow: configuredModel.contextWindow } : {}),
    ...(configuredModel.maxTokens ? { maxTokens: configuredModel.maxTokens } : {}),
    ...(configuredModel.headers ? { headers: configuredModel.headers } : {}),
  };
}

function buildCustomModel(configuredModel: ModelRef): Model<AiApi> | undefined {
  if (
    !configuredModel.api ||
    !configuredModel.baseUrl ||
    configuredModel.reasoning === undefined ||
    !configuredModel.input ||
    !configuredModel.contextWindow ||
    !configuredModel.maxTokens
  ) {
    return undefined;
  }

  return {
    id: configuredModel.modelId,
    name: configuredModel.modelId,
    api: configuredModel.api,
    provider: configuredModel.provider,
    baseUrl: configuredModel.baseUrl,
    reasoning: configuredModel.reasoning,
    input: configuredModel.input,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: configuredModel.contextWindow,
    maxTokens: configuredModel.maxTokens,
    ...(configuredModel.headers ? { headers: configuredModel.headers } : {}),
  };
}

function hasCustomModelOverrides(configuredModel: ModelRef): boolean {
  return Boolean(
    configuredModel.baseUrl ||
      configuredModel.reasoning !== undefined ||
      configuredModel.input ||
      configuredModel.contextWindow ||
      configuredModel.maxTokens ||
      configuredModel.headers,
  );
}
