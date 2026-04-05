import type { AgentEngine } from "./types.js";

export function createDraftEngine(): AgentEngine {
  return {
    async run(input) {
      return {
        message: {
          conversation: input.message.conversation,
          text: `[draft:${input.agent.id}] ${input.message.text}`,
        },
      };
    },
  };
}
