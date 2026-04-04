import { loadBuiltInAgents } from "../agents/definitions.js";
import { createAgentRegistry } from "../agents/registry.js";
import type { Daemon, DaemonConfig } from "./types.js";

export function createDaemon(config: DaemonConfig): Daemon {
  const agentRegistry = createAgentRegistry(loadBuiltInAgents());

  return {
    async start() {
      const defaultAgent = agentRegistry.get(config.defaultAgentId);
      if (!defaultAgent) {
        throw new Error(`Unknown default agent: ${config.defaultAgentId}`);
      }

      console.log(`starting daemon with default agent "${defaultAgent.id}"`);
      console.log(`data dir: ${config.dataDir}`);

      if (config.telegram) {
        console.log("telegram transport is configured but not implemented yet");
      } else {
        console.log("telegram transport is not configured");
      }
    },
  };
}
