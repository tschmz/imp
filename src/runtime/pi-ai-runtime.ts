import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  type Api as AiApi,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const builtinModelCatalog = builtinModels();

export function resolveBuiltinModel(provider: string, modelId: string): Model<AiApi> | undefined {
  return builtinModelCatalog.getModel(provider, modelId);
}

export function isOAuthProvider(provider: string): boolean {
  return Boolean(builtinModelCatalog.getProvider(provider)?.auth.oauth);
}

export const defaultStreamFn: StreamFn = (
  model: Model<AiApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => streamSimple(model, context, options);
