import type { AgentDefinition } from "../domain/agent.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { AgentRunner } from "./types.js";

export function createAgentRunner(agent: AgentDefinition): AgentRunner {
  return {
    async run(message: IncomingMessage): Promise<OutgoingMessage> {
      return {
        conversation: message.conversation,
        text: `[draft:${agent.id}] ${message.text}`,
      };
    },
  };
}
