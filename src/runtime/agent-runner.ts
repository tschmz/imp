import type { AgentDefinition } from "../domain/agent.js";
import type { AgentRunner } from "./types.js";

export function createAgentRunner(agent: AgentDefinition): AgentRunner {
  return {
    async run(input) {
      return {
        message: {
          conversation: input.message.conversation,
          text: `[draft:${agent.id}] ${input.message.text}`,
        },
      };
    },
  };
}
