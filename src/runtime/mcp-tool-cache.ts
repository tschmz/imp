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
      const servers = agent.mcp?.servers ?? [];
      if (servers.length === 0) {
        return {
          tools: [],
          initializedServerIds: [],
          failedServerIds: [],
          async close() {},
        };
      }

      const resolutions = await Promise.all(
        servers.map(async (server) => {
          const cached = cache.get(server.id);
          if (cached) {
            await options.logger?.debug(`reusing cached MCP runtime for server "${server.id}"`);
            return cached.promise;
          }

          await options.logger?.debug(`initializing cached MCP runtime for server "${server.id}"`);
          const promise = options.resolveMcpTools(
            {
              ...agent,
              mcp: {
                servers: [server],
              },
            },
            { logger: options.logger },
          ).catch((error) => {
            cache.delete(server.id);
            throw error;
          });
          cache.set(server.id, { promise });

          const resolution = await promise;
          await options.logger?.debug(`cached MCP runtime ready for server "${server.id}"`);
          return resolution;
        }),
      );

      return {
        tools: resolutions.flatMap((resolution) => resolution.tools),
        initializedServerIds: resolutions.flatMap((resolution) => resolution.initializedServerIds),
        failedServerIds: resolutions.flatMap((resolution) => resolution.failedServerIds),
        async close() {
          // Shared server runtimes are owned by the cache and closed by cache.close().
        },
      };
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
