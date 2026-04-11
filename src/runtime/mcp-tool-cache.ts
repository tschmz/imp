import type { AgentDefinition } from "../domain/agent.js";
import type { Logger } from "../logging/types.js";
import type { ResolvedMcpTools } from "./mcp-tool-runtime.js";

interface CachedMcpToolResolution {
  promise: Promise<ResolvedMcpTools>;
}

export interface McpToolCache {
  resolve(agent: AgentDefinition): Promise<ResolvedMcpTools>;
  close(): Promise<void>;
}

export function createMcpToolCache(options: {
  logger?: Logger;
  resolveMcpTools: (
    agent: AgentDefinition,
    options: {
      logger?: Logger;
    },
  ) => Promise<ResolvedMcpTools>;
}): McpToolCache {
  const cache = new Map<string, CachedMcpToolResolution>();

  return {
    async resolve(agent) {
      if (!agent.mcp || agent.mcp.servers.length === 0) {
        return {
          tools: [],
          async close() {},
        };
      }

      const cached = cache.get(agent.id);
      if (cached) {
        await options.logger?.debug(`reusing cached MCP runtime for agent "${agent.id}"`);
        return cached.promise;
      }

      await options.logger?.debug(`initializing cached MCP runtime for agent "${agent.id}"`);
      const promise = options.resolveMcpTools(agent, { logger: options.logger }).catch((error) => {
        cache.delete(agent.id);
        throw error;
      });
      cache.set(agent.id, { promise });

      const resolution = await promise;
      await options.logger?.debug(`cached MCP runtime ready for agent "${agent.id}"`);
      return resolution;
    },
    async close() {
      const resolutions = [...cache.values()];
      cache.clear();

      if (resolutions.length === 0) {
        return;
      }

      await options.logger?.debug("closing cached MCP runtimes");

      await Promise.all(
        resolutions.map(async ({ promise }) => {
          const resolution = await promise;
          await resolution.close();
        }),
      );

      await options.logger?.debug("closed cached MCP runtimes");
    },
  };
}
