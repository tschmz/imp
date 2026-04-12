import { join } from "node:path";
import { z } from "zod";
import type { CliEndpointConfig } from "../../config/types.js";
import type { ActiveEndpointRuntimeConfig, CliEndpointRuntimeConfig } from "../../daemon/types.js";
import type { Logger } from "../../logging/types.js";
import type { Transport } from "../types.js";
import { createCliTransport } from "./cli-transport.js";

const endpointIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Endpoint ids may only contain letters, numbers, hyphens, and underscores.",
  );

export const cliTransportConfigSchema = z.object({
  id: endpointIdSchema,
  type: z.literal("cli"),
  enabled: z.boolean(),
  routing: z
    .object({
      defaultAgentId: z.string().min(1).optional(),
    })
    .optional(),
}).strict();

export function normalizeCliRuntimeConfig(
  endpoint: CliEndpointConfig,
  options: {
    dataRoot: string;
    defaultAgentId: string;
  },
): ActiveEndpointRuntimeConfig {
  const endpointRoot = join(options.dataRoot, "endpoints", endpoint.id);
  const logsDir = join(options.dataRoot, "logs", "endpoints");
  const runtimeDir = join(options.dataRoot, "runtime", "endpoints");

  return {
    id: endpoint.id,
    type: endpoint.type,
    userId: "local",
    defaultAgentId: endpoint.routing?.defaultAgentId ?? options.defaultAgentId,
    paths: {
      dataRoot: options.dataRoot,
      endpointRoot,
      conversationsDir: join(endpointRoot, "conversations"),
      logsDir,
      logFilePath: join(logsDir, `${endpoint.id}.log`),
      runtimeDir,
      runtimeStatePath: join(runtimeDir, `${endpoint.id}.json`),
    },
  };
}

export function createCliTransportFromRuntimeConfig(
  config: ActiveEndpointRuntimeConfig,
  logger: Logger,
): Transport {
  if (config.type !== "cli") {
    throw new Error(`Expected CLI endpoint runtime config, got "${config.type}".`);
  }

  return createCliTransport(config as CliEndpointRuntimeConfig, logger);
}
