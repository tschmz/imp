import type { ZodType } from "zod";
import type { EndpointConfig } from "../config/types.js";
import type { ActiveEndpointRuntimeConfig } from "../daemon/types.js";
import { TransportResolutionError } from "../domain/errors.js";
import type { Logger } from "../logging/types.js";
import type { Transport, TransportContext } from "./types.js";
import { ensureBuiltInTransportsRegistered } from "./builtins.js";

interface RuntimeNormalizationContext {
  dataRoot: string;
  defaultAgentId: string;
}

export interface TransportRegistryEntry<TBot extends EndpointConfig = EndpointConfig> {
  configSchema: ZodType<TBot>;
  createTransport: (config: ActiveEndpointRuntimeConfig, logger: Logger, context: TransportContext) => Transport;
  normalizeRuntimeConfig: (endpoint: TBot, context: RuntimeNormalizationContext) => ActiveEndpointRuntimeConfig;
}

const transportRegistry = new Map<string, TransportRegistryEntry>();

ensureBuiltInTransportsRegistered();

export type TransportType = string;

export function registerTransport(type: string, entry: TransportRegistryEntry): void {
  transportRegistry.set(type, entry);
}

export function getTransport(type: string): TransportRegistryEntry | undefined {
  return transportRegistry.get(type);
}

export function listTransportTypes(): string[] {
  return [...transportRegistry.keys()];
}

export function createTransport(
  type: TransportType,
  config: ActiveEndpointRuntimeConfig,
  logger: Logger,
  context: TransportContext,
): Transport {
  const entry = getTransport(type);
  if (!entry) {
    throw new TransportResolutionError(`Unsupported endpoint transport: ${type}`);
  }

  return entry.createTransport(config, logger, context);
}

export function normalizeRuntimeEndpointConfig(
  endpoint: EndpointConfig,
  context: RuntimeNormalizationContext,
): ActiveEndpointRuntimeConfig {
  const entry = getTransport(endpoint.type);
  if (!entry) {
    throw new TransportResolutionError(`Unsupported endpoint type: ${endpoint.type}`);
  }

  return entry.normalizeRuntimeConfig(endpoint, context);
}
