import type { AgentDefinition } from "../domain/agent.js";

export interface AgentRegistry {
  list(): AgentDefinition[];
  get(id: string): AgentDefinition | undefined;
}

export function createAgentRegistry(agents: AgentDefinition[]): AgentRegistry {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));

  return {
    list() {
      return agents.slice();
    },
    get(id: string) {
      return byId.get(id);
    },
  };
}
